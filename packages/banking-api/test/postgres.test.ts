import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { after, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { failed, runChecksPostgres } from '../src/checks.ts';
import type { PostgresLedger } from '../src/postgres.ts';
import { SAMPLE_NOW, buildSample, fillSample, sampleClock } from '../src/sample.ts';
import { DEFECTS } from './defects.ts';
import { DATABASE_URL, freshSchema, openTestStore, postgresOnly, rowsOf, startApi, startServers, type Reply } from './helpers.ts';

// What only Postgres can show: the SQL ledger checks and their 22 defects on the same SQL, the
// row locks that stand in for SQLite's whole-database lock, and what two server processes on
// one database must still get right. Every other test file runs here too, through
// `npm run test:postgres`; these run only then (skipped on SQLite).

const ledgers: PostgresLedger[] = [];
after(() => Promise.all(ledgers.map((l) => l.close())));
const open = async (schema = freshSchema(), now?: () => string): Promise<PostgresLedger> => {
  const ledger = (await openTestStore(now, schema)) as PostgresLedger;
  ledgers.push(ledger);
  return ledger;
};

// The sample, built through the Postgres store with the sample's clock.
const postgresSample = async (): Promise<PostgresLedger> => {
  const ledger = await open(freshSchema(), sampleClock());
  await fillSample(ledger);
  return ledger;
};

// Past the API and the constraints, as another tool with the rights could: replica mode turns
// off the foreign keys (and every trigger) for this transaction only.
const inject = (ledger: PostgresLedger, sql: string) =>
  ledger.query(`BEGIN; SET LOCAL session_replication_role = replica; ${sql}; COMMIT;`);

const fired = async (ledger: PostgresLedger) =>
  (await runChecksPostgres((text, params) => ledger.query(text, params), undefined, { now: SAMPLE_NOW })).filter(failed).map((r) => r.id).sort();

const tally = (replies: Reply[]) => {
  const counts: Record<string, number> = {};
  for (const r of replies) counts[`${r.status}${r.body?.code ? ` ${r.body.code}` : ''}`] = (counts[`${r.status}${r.body?.code ? ` ${r.body.code}` : ''}`] ?? 0) + 1;
  return counts;
};

describe('the SQL ledger checks on Postgres', postgresOnly(), () => {
  test('BK-R26 BK-R27 BK-R28 BK-R29 the clean sample, built through the Postgres store, passes every check', async () => {
    assert.deepEqual(await fired(await postgresSample()), []);
  });

  test('BK-R30 the sample has the same ids on Postgres as on SQLite, so the defects mean the same rows', async () => {
    const sqlite = await buildSample();
    const postgres = await postgresSample();
    try {
      for (const sql of ['SELECT id, kind, owner, currency FROM accounts ORDER BY id', 'SELECT id, kind, from_account_id, to_account_id, amount FROM transfers ORDER BY id', 'SELECT id, transfer_id, account_id, amount FROM ledger_entries ORDER BY id', 'SELECT key, transfer_id FROM idempotency_keys ORDER BY key']) {
        const plain = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : String(v)])));
        assert.deepEqual(plain(await rowsOf(postgres, sql)), plain(await rowsOf(sqlite, sql)), sql);
      }
    } finally {
      await sqlite.close();
    }
  });

  for (const { name, rule, sql, expect } of DEFECTS) {
    test(`${rule} defect "${name}" fires exactly the same checks on Postgres: ${expect.join(', ') || 'nothing'}`, async () => {
      const ledger = await postgresSample();
      await inject(ledger, sql);
      assert.deepEqual(await fired(ledger), [...expect].sort());
    });
  }

  test('BK-R30 npm run check reads a Postgres ledger: 0 when clean, 1 with a defect, and it creates nothing', async () => {
    const ledger = await postgresSample();
    await ledger.releaseKey('in-flight'); // checked at the real time, so the key would be stale
    const cli = (schema: string) => spawnSync(process.execPath, ['src/check.ts', '--db', DATABASE_URL!], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, DATABASE_SCHEMA: schema },
    });
    const clean = cli(ledger.schema);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /14\/14 checks passed/);
    await inject(ledger, 'UPDATE ledger_entries SET amount = 1001 WHERE id = 8');
    const broken = cli(ledger.schema);
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /FAIL  transfer_not_balanced +1 row\(s\)\n +transfer_id=4, total=1/);
    // A schema with no ledger in it: every check says why it could not run, and no table appears.
    const empty = freshSchema();
    await ledger.query(`CREATE SCHEMA ${empty}`);
    const missing = cli(empty);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /could not run: relation "transfers" does not exist/);
    assert.deepEqual(await ledger.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1', [empty]), []);
  });
});

describe('the schema on Postgres', postgresOnly(), () => {
  test('BK-R13 BK-R14 the database itself refuses a zero amount, a transfer to the same account, an unknown currency and an entry for a missing account', async () => {
    const ledger = await open();
    const a = (await ledger.openAccount('Ada', 'CAD')).id;
    await assert.rejects(ledger.query(`INSERT INTO transfers (kind, from_account_id, to_account_id, amount, currency, created_at) VALUES ('transfer', ${a}, ${a}, 1, 'CAD', 't')`), /check constraint/);
    await assert.rejects(ledger.query("INSERT INTO accounts (kind, owner, currency, created_at) VALUES ('customer', 'X', 'EUR', 't')"), /check constraint/);
    await assert.rejects(ledger.query(`INSERT INTO ledger_entries (transfer_id, account_id, amount, currency) VALUES (1, ${a}, 0, 'CAD')`), /check constraint|foreign key/);
    await assert.rejects(ledger.query("INSERT INTO ledger_entries (transfer_id, account_id, amount, currency) VALUES (999, 999, 5, 'CAD')"), /foreign key/);
  });

  test('BK-R04 BK-R06 an amount past 2^53 is stored and summed exactly, as BIGINT and NUMERIC', async () => {
    const ledger = await open();
    const id = (await ledger.openAccount('Ada', 'CAD')).id;
    assert.ok((await ledger.deposit(id, 9_007_199_254_740_993n, 'CAD')).ok);
    assert.ok((await ledger.deposit(id, 1n, 'CAD')).ok);
    const [row] = await ledger.query("SELECT SUM(amount)::text AS total, pg_typeof(SUM(amount))::text AS type FROM ledger_entries WHERE amount > 0");
    assert.deepEqual(row, { total: '9007199254740994', type: 'numeric' });
    assert.equal((await ledger.getAccount(id))!.balance, 9_007_199_254_740_994n);
  });

  test('BK-R25 three servers opening one new schema at the same moment: one makes the tables, all three work', async () => {
    const schema = freshSchema();
    const three = await Promise.all([open(schema), open(schema), open(schema)]);
    const ids = await Promise.all(three.map((l, i) => l.openAccount(`Owner ${i}`, 'CAD')));
    assert.equal(new Set(ids.map((a) => a.id)).size, 3);
    assert.equal((await three[0]!.listAccounts()).length, 3);
  });
});

describe('row locks in place of the whole-database lock', postgresOnly(), () => {
  test('BK-R24 BK-R25 a movement waits for a row lock held from outside, then answers 201, not before', async () => {
    const api = await startApi();
    const id = await api.openAccount('CAD');
    const ledger = api.ledger as PostgresLedger;
    const holder = await ledger.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [id]);
      let answered = false;
      const reply = api.post(`/accounts/${id}/deposits`, { amount: '1.00', currency: 'CAD' }).then((r) => { answered = true; return r; });
      await sleep(300);
      assert.equal(answered, false, 'the deposit was written while another transaction held the account');
      await holder.query('COMMIT');
      assert.equal((await reply).status, 201);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  });

  // The Postgres side of the SQLite busy test in concurrency.test.ts: a lock held past the store's
  // lock timeout is 503, as a file locked past the busy timeout is. Without a lock timeout the
  // request waited for as long as the lock was held (found by the code review).
  test('BK-R25 BK-R16 a write that can\'t get its row lock in time is 503 busy with Retry-After, nothing is written, and the key is free again', async () => {
    const ledger = await open(freshSchema(), undefined);
    const quick = (await (await import('../src/postgres.ts')).PostgresLedger.open(DATABASE_URL!, { schema: ledger.schema, lockTimeoutMs: 200, max: 3 }));
    ledgers.push(quick);
    const server = createApp(quick);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const id = (await ledger.openAccount('Locked', 'CAD')).id;
    const deposit = () => fetch(`${base}/accounts/${id}/deposits`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'locked' }, body: JSON.stringify({ amount: '1.00', currency: 'CAD' }),
    });
    const holder = await ledger.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [id]);
      const res = await deposit();
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('retry-after'), '1');
      assert.equal((await res.json()).code, 'busy');
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
    assert.equal(Number((await ledger.query('SELECT COUNT(*) AS n FROM transfers'))[0]!.n), 0);
    const retry = await deposit();
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replayed'), null);
  });

  test('BK-R24 BK-R16 60 transfers in both directions at once between two accounts, through two servers: no deadlock, no 500, and the money adds up', async () => {
    const servers = await startServers(2, { SCREENING_DELAY_MS: '5' });
    const [one, two] = servers.bases as [string, string];
    const a = (await servers.post(one, '/accounts', { owner: 'A', currency: 'CAD' })).body.id;
    const b = (await servers.post(one, '/accounts', { owner: 'B', currency: 'CAD' })).body.id;
    for (const id of [a, b]) await servers.post(one, `/accounts/${id}/deposits`, { amount: '100.00', currency: 'CAD' });
    const replies = await Promise.all(Array.from({ length: 60 }, (_, i) => servers.post(i % 2 ? one : two, '/transfers', {
      from_account_id: i % 2 ? a : b, to_account_id: i % 2 ? b : a, amount: '7.00', currency: 'CAD',
    })));
    assert.ok(replies.every((r) => r.status === 201 || r.body.code === 'insufficient_funds'), JSON.stringify(tally(replies)));
    const balances = await Promise.all([a, b].map(async (id) => (await servers.get(two, `/accounts/${id}`)).body.balance));
    assert.equal(balances.reduce((sum: number, v: string) => sum + Math.round(Number(v) * 100), 0), 20_000);
    assert.deepEqual(await servers.failingChecks(), []);
  });

  // Each deposit locks only its own account, so deposits into different accounts don't wait for
  // each other there. The limit is on what the whole currency holds: without the currency's own
  // lock, all ten read the same total and pass it (seen with that lock taken out).
  test('BK-R06 BK-R24 10 deposits of 0.010 KWD at once into five accounts, through two servers, with room for 3 under the limit: exactly 3 pass', async () => {
    const servers = await startServers(2, { SCREENING_DELAY_MS: '20' });
    const [one, two] = servers.bases as [string, string];
    const openKwd = async () => (await servers.post(one, '/accounts', { owner: 'Fils', currency: 'KWD' })).body.id as number;
    const full = await openKwd();
    await servers.post(one, `/accounts/${full}/deposits`, { amount: '99999999999999.969', currency: 'KWD' });
    const targets = [await openKwd(), await openKwd(), await openKwd(), await openKwd(), await openKwd()];
    const replies = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      servers.post(i % 2 ? one : two, `/accounts/${targets[i % 5]}/deposits`, { amount: '0.010', currency: 'KWD' })));
    assert.deepEqual(tally(replies), { '201': 3, '422 limit_exceeded': 7 });
    assert.deepEqual(await servers.failingChecks(), []);
  });

  test('BK-R14 two first deposits in a currency at once: both go through, and the currency has one funding account', async () => {
    const api = await startApi({ screen: () => sleep(20) });
    const [a, b] = [await api.openAccount('JPY'), await api.openAccount('JPY')];
    const replies = await Promise.all([a, b].map((id) => api.post(`/accounts/${id}/deposits`, { amount: '500', currency: 'JPY' })));
    assert.deepEqual(replies.map((r) => r.status), [201, 201]);
    assert.equal(Number((await api.rows("SELECT COUNT(*) AS n FROM accounts WHERE kind = 'funding' AND currency = 'JPY'"))[0]!.n), 1);
  });

  test('BK-R43 BK-R45 two cash deposits of 6,000.00 at once to one account, through two server processes: one allowed, one reported', async () => {
    const servers = await startServers(2, { SCREENING_DELAY_MS: '100' });
    const [one, two] = servers.bases as [string, string];
    const id = (await servers.post(one, '/accounts', { owner: 'Ada Lovelace', currency: 'CAD' })).body.id;
    const replies = await Promise.all([one, two].map((base) => servers.post(base, `/accounts/${id}/deposits`, { amount: '6000.00', currency: 'CAD' })));
    assert.deepEqual(replies.map((r) => r.status), [201, 201]);
    const decisions = (await servers.get(one, '/screening-decisions', { 'X-Role': 'auditor' })).body.decisions;
    assert.deepEqual(decisions.map((d: { decision: string; rule: string | null }) => `${d.decision} ${d.rule}`), ['allowed null', 'reported 24_hour']);
  });
});
