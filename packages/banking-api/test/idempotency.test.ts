import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { KEY_TTL_MS } from '../src/ledger.ts';
import { startApi, type Api, type Reply } from './helpers.ts';

// Idempotency keys over HTTP: a retried request moves money once. Each title starts
// with the rules it checks.

const api = await startApi();
let keys = 0;
const newKey = () => `key-${++keys}-${process.pid}`;

const keyed = (target: Api, key: string) => ({
  deposit: (id: number, amount: unknown, currency = 'CAD') => target.request('POST', `/accounts/${id}/deposits`, { amount, currency }, { 'Idempotency-Key': key }),
  withdraw: (id: number, amount: unknown, currency = 'CAD') => target.request('POST', `/accounts/${id}/withdrawals`, { amount, currency }, { 'Idempotency-Key': key }),
  transfer: (from: unknown, to: unknown, amount: unknown, currency = 'CAD') =>
    target.request('POST', '/transfers', { from_account_id: from, to_account_id: to, amount, currency }, { 'Idempotency-Key': key }),
});
const balance = async (target: Api, id: number) => (await target.get(`/accounts/${id}`)).body.balance as string;
const count = (target: Api, table: string) => Number((target.ledger.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

function refused(reply: Reply, status: number, code: string) {
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  assert.equal(reply.body.code, code);
  assert.equal(typeof reply.body.error, 'string');
}

async function funded(target: Api, amount: string, currency = 'CAD'): Promise<number> {
  const id = await target.openAccount(currency);
  assert.equal((await target.post(`/accounts/${id}/deposits`, { amount, currency })).status, 201);
  return id;
}

describe('the Idempotency-Key header', () => {
  for (const [label, key] of [['1 character', 'a'], ['255 characters', 'k'.repeat(255)], ['every visible ASCII character', '!~0aZ-_.:/{}"\'']] as const) {
    test(`BK-R19 a key of ${label} is accepted`, async () => {
      const id = await api.openAccount('CAD');
      const reply = await keyed(api, key).deposit(id, '1.00');
      assert.equal(reply.status, 201, JSON.stringify(reply.body));
    });
  }

  for (const [label, key] of [['empty', ''], ['256 characters', 'k'.repeat(256)], ['with a space', 'a b'], ['with a non-ASCII letter', 'clé']] as const) {
    test(`BK-R19 BK-R16 a key ${label} is refused with 400 invalid_idempotency_key and nothing is written`, async () => {
      const id = await api.openAccount('CAD');
      const before = count(api, 'transfers');
      refused(await keyed(api, key).deposit(id, '1.00'), 400, 'invalid_idempotency_key');
      assert.equal(count(api, 'transfers'), before);
    });
  }

  test('BK-R19 without a key, two identical requests are two movements', async () => {
    const id = await api.openAccount('CAD');
    await api.post(`/accounts/${id}/deposits`, { amount: '5.00', currency: 'CAD' });
    await api.post(`/accounts/${id}/deposits`, { amount: '5.00', currency: 'CAD' });
    assert.equal(await balance(api, id), '10.00');
  });

  test('BK-R19 routes that move no money ignore the header, even a malformed one', async () => {
    const reply = await api.request('POST', '/accounts', { owner: 'Ada', currency: 'CAD' }, { 'Idempotency-Key': 'a b' });
    assert.equal(reply.status, 201);
  });
});

describe('replays', () => {
  test('BK-R20 a retried deposit answers the same 201 body, marked as a replay, and moves the money once', async () => {
    const id = await api.openAccount('CAD');
    const k = keyed(api, newKey());
    const first = await k.deposit(id, '25.00');
    const before = count(api, 'ledger_entries');
    const again = await k.deposit(id, '25.00');
    assert.equal(first.status, 201);
    assert.equal(first.headers.get('idempotent-replayed'), null);
    assert.equal(again.status, 201);
    assert.equal(again.headers.get('idempotent-replayed'), 'true');
    assert.deepEqual(again.body, first.body);
    assert.equal(await balance(api, id), '25.00');
    assert.equal(count(api, 'ledger_entries'), before);
  });

  test('BK-R20 withdrawals and transfers replay too, even after the balance has run out', async () => {
    const a = await funded(api, '10.00');
    const b = await api.openAccount('CAD');
    const w = keyed(api, newKey());
    const t = keyed(api, newKey());
    const withdrawal = await w.withdraw(a, '4.00');
    const transfer = await t.transfer(a, b, '6.00');
    assert.equal(await balance(api, a), '0.00');
    for (const [first, again] of [[withdrawal, await w.withdraw(a, '4.00')], [transfer, await t.transfer(a, b, '6.00')]]) {
      assert.equal(again!.status, 201);
      assert.equal(again!.headers.get('idempotent-replayed'), 'true');
      assert.deepEqual(again!.body, first!.body);
    }
    assert.deepEqual([await balance(api, a), await balance(api, b)], ['0.00', '6.00']);
  });

  test('BK-R20 the same amount written differently is the same request: "5" and "5.00" CAD', async () => {
    const id = await api.openAccount('CAD');
    const k = keyed(api, newKey());
    const first = await k.deposit(id, '5');
    const again = await k.deposit(id, '5.00');
    assert.equal(again.headers.get('idempotent-replayed'), 'true');
    assert.deepEqual(again.body, first.body);
    assert.equal(await balance(api, id), '5.00');
  });

  test('BK-R20 BK-R22 the key is linked to the transfer it answered for, once', async () => {
    const id = await api.openAccount('CAD');
    const key = newKey();
    const first = await keyed(api, key).deposit(id, '1.00');
    await keyed(api, key).deposit(id, '1.00');
    const rows = api.ledger.db.prepare('SELECT transfer_id FROM idempotency_keys WHERE key = ?').all(key);
    assert.deepEqual(rows.map((r) => Number(r.transfer_id)), [first.body.id]);
  });
});

describe('a key reused for something else', () => {
  test('BK-R21 a different amount, account, route or currency with a used key is 422 idempotency_key_mismatch, and nothing is written', async () => {
    const a = await funded(api, '50.00');
    const b = await api.openAccount('CAD');
    const usd = await api.openAccount('USD');
    const key = newKey();
    const k = keyed(api, key);
    await k.deposit(a, '5.00');
    const before = count(api, 'transfers');
    for (const reply of [
      await k.deposit(a, '5.01'),
      await k.deposit(b, '5.00'),
      await k.withdraw(a, '5.00'),
      await k.transfer(a, b, '5.00'),
      await k.deposit(usd, '5.00', 'USD'),
    ]) refused(reply, 422, 'idempotency_key_mismatch');
    assert.equal(count(api, 'transfers'), before);
    assert.deepEqual([await balance(api, a), await balance(api, b)], ['55.00', '0.00']);
  });

  test('BK-R21 BK-R16 refusal order with a used key: a bad request is still 400, and the key comes before an unknown account', async () => {
    const a = await api.openAccount('CAD');
    const k = keyed(api, newKey());
    await k.deposit(a, '5.00');
    refused(await k.deposit(a, 5), 400, 'invalid_amount');
    refused(await k.deposit(999_999, '5.00'), 422, 'idempotency_key_mismatch');
  });

  test('BK-R21 a key whose first request is still running is 409 idempotency_key_in_use; once it is done, the key replays', { timeout: 10_000 }, async () => {
    // The screening holds every request until released. A request that wrongly gets
    // past the key waits too, so the second request is raced against a short timer:
    // it must be refused, not held.
    const held: (() => void)[] = [];
    let open = false;
    let entered!: () => void;
    const screening = new Promise<void>((resolve) => { entered = resolve; });
    const own = await startApi({ screen: async () => { entered(); if (!open) await new Promise<void>((resolve) => { held.push(resolve); }); } });
    const id = await own.openAccount('CAD');
    const k = keyed(own, 'held');
    const first = k.deposit(id, '7.00');
    await screening; // the first request is now waiting on its screening
    const second = k.deposit(id, '7.00');
    const outcome = await Promise.race([second, sleep(1000).then(() => 'held in screening')]);
    open = true;
    held.forEach((release) => release());
    assert.notEqual(outcome, 'held in screening', 'the second request got past the key');
    refused(outcome as Reply, 409, 'idempotency_key_in_use');
    assert.equal((await first).status, 201);
    const again = await k.deposit(id, '7.00');
    assert.equal(again.headers.get('idempotent-replayed'), 'true');
    assert.equal(await balance(own, id), '7.00');
  });
});

describe('refused and failed requests keep no key', () => {
  test('BK-R22 a refused withdrawal leaves no key: after a deposit, the same key goes through', async () => {
    const id = await api.openAccount('CAD');
    const k = keyed(api, newKey());
    refused(await k.withdraw(id, '10.00'), 422, 'insufficient_funds');
    await api.post(`/accounts/${id}/deposits`, { amount: '10.00', currency: 'CAD' });
    const retry = await k.withdraw(id, '10.00');
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replayed'), null);
    assert.equal(await balance(api, id), '0.00');
  });

  test('BK-R22 a request refused with 404 leaves no key, so the key is free for another request', async () => {
    const id = await api.openAccount('CAD');
    const k = keyed(api, newKey());
    refused(await k.deposit(999_999, '1.00'), 404, 'not_found');
    assert.equal((await k.deposit(id, '1.00')).status, 201);
  });

  test('BK-R22 BK-R13 a database failure while writing leaves no transfer and no key; the retry goes through once', async () => {
    const own = await startApi();
    const id = await own.openAccount('CAD');
    const k = keyed(own, 'retry-after-failure');
    own.ledger.db.exec("CREATE TEMP TRIGGER fail_credit BEFORE INSERT ON ledger_entries WHEN NEW.amount > 0 BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    refused(await k.deposit(id, '3.00'), 500, 'internal');
    own.ledger.db.exec('DROP TRIGGER fail_credit');
    assert.deepEqual([count(own, 'transfers'), count(own, 'idempotency_keys')], [0, 0]);
    assert.equal((await k.deposit(id, '3.00')).headers.get('idempotent-replayed'), null);
    assert.equal((await k.deposit(id, '3.00')).headers.get('idempotent-replayed'), 'true');
    assert.equal(await balance(own, id), '3.00');
  });

  test('BK-R22 BK-R13 the key is linked in the same transaction: if linking fails, the transfer is not written either', async () => {
    const own = await startApi();
    const id = await own.openAccount('CAD');
    own.ledger.db.exec("CREATE TEMP TRIGGER fail_link BEFORE UPDATE ON idempotency_keys BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    refused(await keyed(own, 'link').deposit(id, '3.00'), 500, 'internal');
    own.ledger.db.exec('DROP TRIGGER fail_link');
    assert.deepEqual([count(own, 'transfers'), count(own, 'ledger_entries'), count(own, 'idempotency_keys')], [0, 0, 0]);
    assert.equal(await balance(own, id), '0.00');
  });
});

describe('keys expire after 24 hours', () => {
  test('BK-R23 a key replays until 24 hours after its first use, and is a new movement from then on', async () => {
    let clock = Date.parse('2026-10-20T12:00:00.000Z');
    const own = await startApi({ now: () => new Date(clock).toISOString() });
    const id = await own.openAccount('CAD');
    const k = keyed(own, 'daily');
    const first = await k.deposit(id, '1.00');
    clock += KEY_TTL_MS - 1;
    const replay = await k.deposit(id, '1.00');
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
    assert.equal(replay.body.id, first.body.id);
    clock += 1;
    const fresh = await k.deposit(id, '1.00');
    assert.equal(fresh.status, 201);
    assert.equal(fresh.headers.get('idempotent-replayed'), null);
    assert.notEqual(fresh.body.id, first.body.id);
    assert.equal(await balance(own, id), '2.00');
  });

  test('BK-R23 an expired key may be used for a different request', async () => {
    let clock = Date.parse('2026-10-20T12:00:00.000Z');
    const own = await startApi({ now: () => new Date(clock).toISOString() });
    const id = await own.openAccount('CAD');
    const k = keyed(own, 'reused');
    await k.deposit(id, '1.00');
    refused(await k.deposit(id, '2.00'), 422, 'idempotency_key_mismatch');
    clock += KEY_TTL_MS;
    assert.equal((await k.deposit(id, '2.00')).status, 201);
  });
});
