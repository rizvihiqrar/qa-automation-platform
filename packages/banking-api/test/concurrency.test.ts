import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from '../src/app.ts';
import { failed, runChecks } from '../src/checks.ts';
import { BUSY_TIMEOUT_MS, Ledger } from '../src/ledger.ts';
import { MAX_MINOR, formatAmount } from '../src/money.ts';
import { startApi, startServers, type Reply } from './helpers.ts';

// Requests at the same time, for real. Two kinds of overlap: a wait inside one
// process (the screening awaited before each movement, during which other requests
// run), and two server processes on one SQLite file, each with its own connection.
// Nothing is interleaved by hand: requests are fired together and the database and
// the event loop decide the order.

const tally = (replies: Reply[]) => {
  const counts: Record<string, number> = {};
  for (const r of replies) {
    const key = `${r.status}${r.body?.code ? ` ${r.body.code}` : ''}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const slowScreen = () => sleep(20);

// The SQL ledger checks that fail on a file the races left, opened read-only while the
// servers still run. Whole results, so a failure shows the rows.
const checkFile = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
  try {
    return runChecks(db).filter(failed);
  } finally {
    db.close();
  }
};

describe('one process: requests overlap while the screening runs', () => {
  test('BK-R24 BK-R12 20 transfers of 10.00 at once from 100.00: exactly 10 pass, and the balance stops at zero', async () => {
    const api = await startApi({ screen: slowScreen });
    const from = await api.openAccount('CAD');
    const to = await api.openAccount('CAD');
    await api.post(`/accounts/${from}/deposits`, { amount: '100.00', currency: 'CAD' });
    const replies = await Promise.all(Array.from({ length: 20 }, () =>
      api.post('/transfers', { from_account_id: from, to_account_id: to, amount: '10.00', currency: 'CAD' })));
    assert.deepEqual(tally(replies), { '201': 10, '422 insufficient_funds': 10 });
    assert.deepEqual([(await api.get(`/accounts/${from}`)).body.balance, (await api.get(`/accounts/${to}`)).body.balance], ['0.00', '100.00']);
  });

  test('BK-R24 BK-R06 10 deposits of 0.010 KWD at once with room for 3 under the limit: exactly 3 pass', async () => {
    const api = await startApi({ screen: slowScreen });
    const id = await api.openAccount('KWD');
    await api.post(`/accounts/${id}/deposits`, { amount: formatAmount(MAX_MINOR - 30n, 'KWD'), currency: 'KWD' });
    const replies = await Promise.all(Array.from({ length: 10 }, () =>
      api.post(`/accounts/${id}/deposits`, { amount: '0.010', currency: 'KWD' })));
    assert.deepEqual(tally(replies), { '201': 3, '422 limit_exceeded': 7 });
    assert.equal((await api.get(`/accounts/${id}`)).body.balance, formatAmount(MAX_MINOR, 'KWD'));
  });

  // Which of the others still find the first in flight (409) and which arrive after it
  // finished (a replay) depends on the machine: on a slow CI runner, 2 of 9 came late.
  // What must hold either way: one movement, and every other answer is one of those two.
  // The 409 itself is shown without timing in idempotency.test.ts.
  test('BK-R21 BK-R24 the same keyed transfer sent 10 times at once moves the money once; the others are 409 or a replay of it', async () => {
    const api = await startApi({ screen: slowScreen });
    const from = await api.openAccount('CAD');
    const to = await api.openAccount('CAD');
    await api.post(`/accounts/${from}/deposits`, { amount: '100.00', currency: 'CAD' });
    const replies = await Promise.all(Array.from({ length: 10 }, () =>
      api.request('POST', '/transfers', { from_account_id: from, to_account_id: to, amount: '30.00', currency: 'CAD' }, { 'Idempotency-Key': 'storm' })));
    const fresh = replies.filter((r) => r.status === 201 && r.headers.get('idempotent-replayed') !== 'true');
    const replayed = replies.filter((r) => r.status === 201 && r.headers.get('idempotent-replayed') === 'true');
    const inFlight = replies.filter((r) => r.status === 409 && r.body.code === 'idempotency_key_in_use');
    assert.equal(fresh.length, 1, JSON.stringify(tally(replies)));
    assert.equal(fresh.length + replayed.length + inFlight.length, 10, JSON.stringify(tally(replies)));
    for (const r of replayed) assert.deepEqual(r.body, fresh[0]!.body);
    assert.equal((await api.get(`/accounts/${from}`)).body.balance, '70.00');
    assert.equal((await api.get(`/accounts/${from}/entries`)).body.entries.length, 2);
  });
});

describe('two server processes on one database file', async () => {
  const servers = await startServers(2);
  const [one, two] = servers.bases as [string, string];

  test('BK-R24 BK-R25 60 withdrawals of 10.00 at once from 100.00, through both servers: exactly 10 pass, the rest are refused, none is a 500', async () => {
    const id = (await servers.post(one, '/accounts', { owner: 'Race', currency: 'CAD' })).body.id;
    await servers.post(one, `/accounts/${id}/deposits`, { amount: '100.00', currency: 'CAD' });
    const replies = await Promise.all(Array.from({ length: 60 }, (_, i) =>
      servers.post(i % 2 ? one : two, `/accounts/${id}/withdrawals`, { amount: '10.00', currency: 'CAD' })));
    assert.deepEqual(tally(replies), { '201': 10, '422 insufficient_funds': 50 });
    assert.equal((await servers.get(two, `/accounts/${id}`)).body.balance, '0.00');
  });

  test('BK-R25 a server waits for another connection\'s write to finish, then answers 201', async () => {
    const id = (await servers.post(one, '/accounts', { owner: 'Wait', currency: 'CAD' })).body.id;
    // A busy timeout here too: in SQLite's default journal mode a COMMIT waits for
    // readers in the other process to finish, and without one it fails at once.
    const holder = new DatabaseSync(servers.dbPath, { timeout: BUSY_TIMEOUT_MS });
    holder.exec('BEGIN IMMEDIATE');
    const reply = servers.post(two, `/accounts/${id}/deposits`, { amount: '1.00', currency: 'CAD' });
    await sleep(300);
    holder.exec('COMMIT');
    holder.close();
    assert.equal((await reply).status, 201);
  });

  test('BK-R13 BK-R24 BK-R26 BK-R27 BK-R28 what the races left in the file passes every SQL ledger check', () => {
    assert.deepEqual(checkFile(servers.dbPath), []);
  });
});

describe('two server processes with a slow screening', async () => {
  // The delay is the window in which a request is still in flight, so a repeat of a key gets 409. A loaded runner
  // can spread the requests wider than 30 ms, and a request that arrives after the first has finished is a replay
  // (201), so the one-key test below counts replays apart instead of relying on the window.
  const servers = await startServers(2, { SCREENING_DELAY_MS: '300' });
  const [one, two] = servers.bases as [string, string];

  test('BK-R24 20 transfers of 10.00 at once from 100.00, through both servers: exactly 10 pass, and the balance stops at zero', async () => {
    const from = (await servers.post(one, '/accounts', { owner: 'From', currency: 'CAD' })).body.id;
    const to = (await servers.post(one, '/accounts', { owner: 'To', currency: 'CAD' })).body.id;
    await servers.post(one, `/accounts/${from}/deposits`, { amount: '100.00', currency: 'CAD' });
    const replies = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      servers.post(i % 2 ? one : two, '/transfers', { from_account_id: from, to_account_id: to, amount: '10.00', currency: 'CAD' })));
    assert.deepEqual(tally(replies), { '201': 10, '422 insufficient_funds': 10 });
    assert.equal((await servers.get(one, `/accounts/${from}`)).body.balance, '0.00');
  });

  test('BK-R21 BK-R20 one key sent to both servers at once: one movement, the rest 409 or a replay of it, and a later retry replays it', async () => {
    const id = (await servers.post(one, '/accounts', { owner: 'Key', currency: 'CAD' })).body.id;
    const send = (base: string) => servers.post(base, `/accounts/${id}/deposits`, { amount: '9.00', currency: 'CAD' }, { 'Idempotency-Key': 'both-servers' });
    const replies = await Promise.all(Array.from({ length: 10 }, (_, i) => send(i % 2 ? one : two)));
    // Exactly one request did the work. A slow arrival can also be a replay (201 with the replay header), never a second movement.
    const fresh = replies.filter((r) => r.status === 201 && r.headers.get('idempotent-replayed') !== 'true');
    assert.equal(fresh.length, 1);
    for (const r of replies) assert.ok(r.status === 409 || (r.status === 201 && r.headers.get('idempotent-replayed') === 'true') || r === fresh[0], `unexpected ${r.status}`);
    const retry = await send(two);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true');
    assert.deepEqual(retry.body, fresh[0]!.body);
    assert.equal((await servers.get(one, `/accounts/${id}`)).body.balance, '9.00');
  });

  test('BK-R24 BK-R26 BK-R27 BK-R28 BK-R29 what these races left in the file passes every SQL ledger check', () => {
    assert.deepEqual(checkFile(servers.dbPath), []);
  });
});

describe('a database locked for too long', () => {
  test('BK-R25 BK-R16 a write that can\'t get the lock in time is 503 busy with Retry-After, and nothing is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banking-api-'));
    const dbPath = join(dir, 'ledger.db');
    const ledger = new Ledger(dbPath, undefined, 100);
    const server = createApp(ledger);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const holder = new DatabaseSync(dbPath);
    try {
      const id = ledger.openAccount('Locked', 'CAD').id;
      holder.exec('BEGIN IMMEDIATE');
      const res = await fetch(`${base}/accounts/${id}/deposits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'locked' }, body: JSON.stringify({ amount: '1.00', currency: 'CAD' }),
      });
      holder.exec('ROLLBACK');
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('retry-after'), '1');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal((await res.json()).code, 'busy');
      assert.equal(Number((ledger.db.prepare('SELECT COUNT(*) AS n FROM transfers').get() as { n: number }).n), 0);
    } finally {
      if (holder.isTransaction) holder.exec('ROLLBACK');
      holder.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
