import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after } from 'node:test';
import { amlRules } from '../src/aml.ts';
import { createApp, type Screen } from '../src/app.ts';
import { failed, runChecks, runChecksPostgres, type CheckResult } from '../src/checks.ts';
import type { Matrix } from '../src/entitlements.ts';
import { BUSY_TIMEOUT_MS, Ledger, type Store } from '../src/ledger.ts';
import { spawnServers, type Running } from '../src/servers.ts';

// The tests run on SQLite, and on Postgres too when DATABASE_URL is set (npm run test:postgres
// starts one in Docker). Each server gets a schema of its own there, so no test sees another's
// rows. A test that is about SQLite itself (a file, its lock, a trigger in its dialect) says so
// with sqliteOnly() and is skipped on Postgres; test/postgres.test.ts has the Postgres versions.
export const DATABASE_URL = process.env.DATABASE_URL || undefined;
export const ON_POSTGRES = DATABASE_URL !== undefined;
export const sqliteOnly = (why: string): { skip: string | false } => ({ skip: ON_POSTGRES ? `SQLite only: ${why}` : false });
export const postgresOnly = (): { skip: string | false } => ({ skip: ON_POSTGRES ? false : 'needs DATABASE_URL (npm run test:postgres)' });

export const freshSchema = (): string => `t_${randomBytes(6).toString('hex')}`;

type Rows = Record<string, unknown>[];

// A store for one test server: SQLite in memory, or a fresh Postgres schema.
export async function openTestStore(now?: () => string, schema = freshSchema()): Promise<Store> {
  if (!DATABASE_URL) return new Ledger(':memory:', now);
  const { PostgresLedger } = await import('../src/postgres.ts');
  return PostgresLedger.open(DATABASE_URL, { schema, now, max: 5 });
}

// Raw SQL on whichever store it is, for what the API doesn't show (row counts, an owner
// renamed behind its back). The same SQL runs on both, so tests use plain SQL only.
export async function rowsOf(store: Store, sql: string): Promise<Rows> {
  if (store instanceof Ledger) {
    // BigInt, as the ledger reads them: a total past 2^53 must not pass through a double.
    const statement = store.db.prepare(sql);
    statement.setReadBigInts(true);
    return statement.all() as Rows;
  }
  return (store as unknown as { query(sql: string): Promise<Rows> }).query(sql);
}

export async function execOn(store: Store, sql: string): Promise<void> {
  if (store instanceof Ledger) store.db.exec(sql);
  else await (store as unknown as { query(sql: string): Promise<Rows> }).query(sql);
}

// The SQL ledger checks that fail on a store, as whole results so a failure shows the rows.
export async function failingChecks(store: Store, now?: Date): Promise<CheckResult[]> {
  const results = store instanceof Ledger
    ? runChecks(store.db, undefined, { now })
    : await runChecksPostgres((text, params) => (store as unknown as { query(t: string, p: unknown[]): Promise<Rows> }).query(text, params), undefined, { now });
  return results.filter(failed);
}

// Makes the store refuse a write from inside the database, the way a full disk would: the
// credit entry (after the debit is written), or the link from a key to its transfer. Returns the
// step that takes it out again. A trigger in each dialect; the message is the same.
export async function failWrites(store: Store, what: 'credit' | 'link'): Promise<() => Promise<void>> {
  const [table, event, when] = what === 'credit' ? ['ledger_entries', 'INSERT', 'NEW.amount > 0'] : ['idempotency_keys', 'UPDATE', null];
  const name = `fail_${what}`;
  if (store instanceof Ledger) {
    store.db.exec(`CREATE TEMP TRIGGER ${name} BEFORE ${event} ON ${table} ${when ? `WHEN ${when} ` : ''}BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    return async () => store.db.exec(`DROP TRIGGER ${name}`);
  }
  await execOn(store, `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'disk full'; END $$;
    CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW ${when ? `WHEN (${when}) ` : ''}EXECUTE FUNCTION ${name}();`);
  return () => execOn(store, `DROP TRIGGER ${name} ON ${table}; DROP FUNCTION ${name}();`);
}

export interface Reply {
  status: number;
  headers: Headers;
  body: any;
}

export interface Api {
  ledger: Store;
  // The SQLite ledger itself, for a test that needs its file or its connection; null on Postgres.
  sqlite: Ledger | null;
  base: string;
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  post(path: string, body: unknown): Promise<Reply>;
  get(path: string): Promise<Reply>;
  openAccount(currency: string, owner?: string): Promise<number>;
  rows(sql: string): Promise<Rows>;
  exec(sql: string): Promise<void>;
  count(table: string): Promise<number>;
}

// A fresh ledger and a server on a free port, closed after the file's tests.
// A string body is sent as it is (for malformed JSON); anything else as JSON.
// `now` sets the ledger's clock and `screen` the wait before each movement; `aml` adds the
// anti-money-laundering rules (BK-R42 to BK-R45), as the real server has them, after it.
export async function startApi({ now, screen, aml = false, entitlements }: { now?: () => string; screen?: Screen; aml?: boolean; entitlements?: Matrix } = {}): Promise<Api> {
  const ledger = await openTestStore(now);
  const server = createApp(ledger, { screen, rules: aml ? amlRules() : undefined, entitlements });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  after(() => new Promise<void>((resolve) => { server.close(() => { ledger.close().then(resolve, resolve); }); server.closeAllConnections(); }));

  const request = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json', ...headers };
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };

  const api: Api = {
    ledger,
    sqlite: ledger instanceof Ledger ? ledger : null,
    base,
    request,
    post: (path, body) => request('POST', path, body),
    get: (path) => request('GET', path),
    async openAccount(currency, owner = 'Test Owner') {
      const reply = await request('POST', '/accounts', { owner, currency });
      if (reply.status !== 201) throw new Error(`could not open a ${currency} account: ${JSON.stringify(reply.body)}`);
      return reply.body.id as number;
    },
    rows: (sql) => rowsOf(ledger, sql),
    exec: (sql) => execOn(ledger, sql),
    async count(table) {
      return Number((await rowsOf(ledger, `SELECT COUNT(*) AS n FROM ${table}`))[0]!.n);
    },
  };
  return api;
}

export interface Servers {
  // The SQLite file the servers share; on Postgres, the schema they share.
  dbPath: string;
  schema: string | null;
  bases: string[];
  post(base: string, path: string, body: unknown, headers?: Record<string, string>): Promise<Reply>;
  get(base: string, path: string, headers?: Record<string, string>): Promise<Reply>;
  // The SQL ledger checks that fail on what the servers wrote, read while they still run.
  failingChecks(): Promise<CheckResult[]>;
}

// Real server processes sharing one SQLite file in a fresh temp folder, or one Postgres
// schema (see spawnServers). Stopped, and the folder removed, after the file's tests.
export async function startServers(count: number, env: Record<string, string> = {}): Promise<Servers> {
  const dir = mkdtempSync(join(tmpdir(), 'banking-api-'));
  const dbPath = join(dir, 'ledger.db');
  const schema = ON_POSTGRES ? freshSchema() : null;
  let running: Running | undefined;
  after(async () => {
    await running?.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  running = await spawnServers(count, dbPath, { ...env, ...(schema ? { DATABASE_SCHEMA: schema } : {}) });
  const { bases } = running;

  const request = async (base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => {
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json', ...headers };
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  return {
    dbPath,
    schema,
    bases,
    post: (base, path, body, headers) => request(base, 'POST', path, body, headers),
    get: (base, path, headers) => request(base, 'GET', path, undefined, headers),
    async failingChecks() {
      if (!schema) {
        const db = new DatabaseSync(dbPath, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
        try {
          return runChecks(db).filter(failed);
        } finally {
          db.close();
        }
      }
      const store = await openTestStore(undefined, schema);
      try {
        return await failingChecks(store);
      } finally {
        await store.close();
      }
    },
  };
}
