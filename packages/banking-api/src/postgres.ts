import { readFileSync } from 'node:fs';
import pg from 'pg';
import { BUSY_TIMEOUT_MS, KEY_TTL_MS, refusalFor, type Account, type Claim, type Decision, type Entry, type Kind, type Movement, type Refusal, type Result, type ScreeningDecision, type Store, type Transfer, type TransferWithEntries } from './ledger.ts';
import type { Currency } from './money.ts';

// The ledger on Postgres (DATABASE_URL): the same Store, the same rules (refusalFor in
// ledger.ts) and the same tables as the SQLite one, so the API, the tests over HTTP and the
// SQL ledger checks don't know which they are using. Only this file and the store factory
// import pg, so the SQLite path keeps no runtime dependency (money-course copies src/ into a
// folder where pg can't be found, and never loads this file).
//
// What SQLite gets from BEGIN IMMEDIATE (the whole database locked for each write), Postgres
// gets from row locks. Under READ COMMITTED two transactions would both sum the old entries,
// so apply() first takes the accounts it moves money between with SELECT ... FOR UPDATE,
// lowest id first, so two opposite transfers wait for each other instead of deadlocking
// (BK-R24). A deposit also takes a lock on its currency, because the limit is on what all
// accounts hold (BK-R06). Every amount comes back as a BigInt: int8 and numeric (what SUM
// gives) are parsed with BigInt, never through a JavaScript number.

const SCHEMA = readFileSync(new URL('../sql/schema.postgres.sql', import.meta.url), 'utf8');

// Postgres type ids: int8 (bigint) and numeric. Every number this ledger reads is a whole one.
const INT8 = 20;
const NUMERIC = 1700;
const types = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') =>
    oid === INT8 || oid === NUMERIC ? (value: string) => BigInt(value) : pg.types.getTypeParser(oid, format as 'text'),
};

type Row = Record<string, unknown>;
type Client = pg.Pool | pg.PoolClient;
const id = (v: unknown): number => Number(v);
const optionalId = (v: unknown): number | null => (v === null ? null : Number(v));
const big = (v: unknown): bigint => (typeof v === 'bigint' ? v : BigInt(v as string | number));

export interface PostgresOptions {
  // The schema the tables live in. Tests give each server its own, so they never share rows.
  schema?: string;
  now?: () => string;
  // Connections in the pool. A movement holds one for its whole transaction.
  max?: number;
  // How long a statement waits for a lock, and a request for a free connection, before giving up
  // with an error the API answers as 503 busy (BK-R25), as SQLite's busy timeout does.
  lockTimeoutMs?: number;
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export class PostgresLedger implements Store {
  readonly pool: pg.Pool;
  readonly schema: string;
  readonly #now: () => string;
  // Set on the store handed to an exclusive section: every call runs on this one connection,
  // inside the section's transaction. Null on the store a server opens.
  readonly #client: pg.PoolClient | null;

  private constructor(pool: pg.Pool, schema: string, now: () => string, client: pg.PoolClient | null = null) {
    this.pool = pool;
    this.schema = schema;
    this.#now = now;
    this.#client = client;
  }

  get #db(): Client {
    return this.#client ?? this.pool;
  }

  // Opens a pool on `url`, makes the schema and its tables if they are missing, and returns the
  // store. When the tables are there already, nothing is run: even CREATE INDEX IF NOT EXISTS takes
  // a lock on its table, and a server restarting (or a test reading the checks) must not queue
  // behind the writers. Several servers may make one new schema at once: an advisory lock makes
  // the first create the tables while the others wait, since CREATE TABLE IF NOT EXISTS is not
  // safe to run twice at the same moment.
  static async open(url: string, { schema = 'public', now = () => new Date().toISOString(), max = 10, lockTimeoutMs = BUSY_TIMEOUT_MS }: PostgresOptions = {}): Promise<PostgresLedger> {
    if (!SCHEMA_NAME.test(schema)) throw new Error(`schema must be a lower-case SQL name, not ${JSON.stringify(schema)}`);
    if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1) throw new Error(`lockTimeoutMs must be a whole number of milliseconds, not ${lockTimeoutMs}`);
    const pool = new pg.Pool({
      connectionString: url, max, types, connectionTimeoutMillis: lockTimeoutMs,
      options: `-c search_path=${schema} -c lock_timeout=${lockTimeoutMs}`,
    });
    // An idle connection that drops (a restart, a network blip) must not crash the server.
    pool.on('error', (err) => console.error('postgres pool:', err.message));
    try {
      const client = await pool.connect();
      try {
        const made = async () => (await client.query('SELECT to_regclass($1) AS t', [`${schema}.screening_decisions`])).rows[0].t !== null;
        if (!(await made())) {
          await client.query("SELECT pg_advisory_lock(hashtext('banking-api schema'))");
          try {
            await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
            if (!(await made())) await client.query(SCHEMA);
          } finally {
            await client.query("SELECT pg_advisory_unlock(hashtext('banking-api schema'))");
          }
        }
      } finally {
        client.release();
      }
    } catch (err) {
      await pool.end();
      throw err;
    }
    return new PostgresLedger(pool, schema, now);
  }

  async close(): Promise<void> {
    if (this.#client) throw new Error('the store inside an exclusive section is closed with its section, not on its own');
    await this.pool.end();
  }

  // The movement's customer accounts, locked lowest id first, and its currency's deposit lock
  // for a deposit: the same locks apply() takes, taken first and held until `work` is done, so
  // what the rules read (a 24-hour total, an owner) can't change before the money is written,
  // whichever server the other request went to. Inside a section already: just `work`.
  //
  // What `work` wrote is kept even when it then fails: the rules' audit row stays when the write
  // of the movement fails (BK-R45), as it does on SQLite, where each is its own transaction. That
  // is safe because every write that can fail part-way (apply, a key claim) runs in a savepoint
  // of its own and is rolled back to it, and a COMMIT after a failed statement rolls back instead.
  async exclusive<T>(m: Movement, work: (store: Store) => Promise<T>): Promise<T> {
    if (this.#client) return work(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let result: T;
      try {
        await this.#lock(client, m);
        result = await work(new PostgresLedger(this.pool, this.schema, this.#now, client));
      } catch (err) {
        await client.query('COMMIT').catch(() => {});
        throw err;
      }
      await client.query('COMMIT');
      return result;
    } finally {
      client.release();
    }
  }

  async #lock(c: pg.PoolClient, m: Movement): Promise<void> {
    // FOR UPDATE waits for any other movement on these accounts to commit, so what is read next
    // is the latest. Lowest id first, so two opposite transfers wait instead of deadlocking.
    const parties = [...new Set([m.from, m.to].filter((p): p is number => p !== null))].sort((a, b) => a - b);
    await c.query("SELECT id FROM accounts WHERE id = ANY($1::bigint[]) AND kind = 'customer' ORDER BY id FOR UPDATE", [parties]);
    // A deposit adds to what the currency's accounts hold, which has a limit (BK-R06): one
    // deposit in a currency at a time. Held until the transaction ends.
    if (m.from === null) await c.query("SELECT pg_advisory_xact_lock(hashtext('issued ' || $1))", [m.currency]);
  }

  // Raw SQL for the checks and the tests, on the store's schema. Amounts come back as BigInt.
  async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.pool.query(sql, params)).rows as Row[];
  }

  // One transaction on one connection. A refusal returned from inside commits (audit rows and
  // key claims are kept); an error rolls back. Inside an exclusive section it is a savepoint of
  // the section's transaction, rolled back to on an error, so the section can keep the rest.
  async #transaction<T>(work: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    if (this.#client) {
      const c = this.#client;
      await c.query('SAVEPOINT store_write');
      try {
        const result = await work(c);
        await c.query('RELEASE SAVEPOINT store_write');
        return result;
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT store_write').catch(() => {});
        throw err;
      }
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async #one(c: Client, sql: string, params: unknown[]): Promise<Row | undefined> {
    return (await c.query(sql, params)).rows[0] as Row | undefined;
  }

  async #account(c: Client, accountId: number): Promise<Account | null> {
    const row = await this.#one(c, `
      SELECT a.id, a.owner, a.currency, a.created_at, COALESCE(SUM(e.amount), 0) AS balance
      FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
      WHERE a.id = $1 AND a.kind = 'customer'
      GROUP BY a.id`, [accountId]);
    if (!row) return null;
    return { id: id(row.id), owner: row.owner as string, currency: row.currency as Currency, balance: big(row.balance), created_at: row.created_at as string };
  }

  async #sentToday(c: Client, accountId: number): Promise<bigint> {
    const start = `${this.#now().slice(0, 10)}T00:00:00.000Z`;
    const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
    const row = await this.#one(c, `
      SELECT COALESCE(SUM(amount), 0) AS sent FROM transfers
      WHERE from_account_id = $1 AND kind IN ('transfer', 'withdrawal') AND created_at >= $2 AND created_at < $3`, [accountId, start, end]);
    return big(row!.sent);
  }

  async #issued(c: Client, currency: Currency): Promise<bigint> {
    const row = await this.#one(c, `
      SELECT COALESCE(-SUM(e.amount), 0) AS issued
      FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
      WHERE a.kind = 'funding' AND a.currency = $1`, [currency]);
    return big(row!.issued);
  }

  // Reads what the rules need, then asks them (refusalFor). The rules are synchronous, so the
  // totals are read first: what the sender sent today if there is a sender, what the currency
  // holds if it is a deposit, even when an earlier rule will refuse the movement anyway.
  async #check(c: Client, m: Movement): Promise<Refusal | null> {
    const from = m.from === null ? null : await this.#account(c, m.from);
    const to = m.to === null ? null : await this.#account(c, m.to);
    const sent = from ? await this.#sentToday(c, from.id) : 0n;
    const issued = m.from === null ? await this.#issued(c, m.currency) : 0n;
    return refusalFor(m, from, to, { sentToday: () => sent, issued: () => issued });
  }

  // The currency's funding account, made the first time it is needed. Two first movements at
  // once may both try: the unique index lets one in and the other reads the one that won. Read
  // first, because an INSERT that does nothing still uses up an id, and the ids would then
  // differ from the SQLite ledger's for the same movements.
  async #fundingAccount(c: Client, currency: Currency): Promise<number> {
    const existing = await this.#one(c, "SELECT id FROM accounts WHERE kind = 'funding' AND currency = $1", [currency]);
    if (existing) return id(existing.id);
    const made = await this.#one(c, `
      INSERT INTO accounts (kind, owner, currency, created_at) VALUES ('funding', 'Funding', $1, $2)
      ON CONFLICT (currency) WHERE kind = 'funding' DO NOTHING RETURNING id`, [currency, this.#now()]);
    if (made) return id(made.id);
    const found = await this.#one(c, "SELECT id FROM accounts WHERE kind = 'funding' AND currency = $1", [currency]);
    return id(found!.id);
  }

  async openAccount(owner: string, currency: Currency): Promise<Account> {
    const created_at = this.#now();
    const row = await this.#one(this.#db, "INSERT INTO accounts (kind, owner, currency, created_at) VALUES ('customer', $1, $2, $3) RETURNING id", [owner, currency, created_at]);
    return { id: id(row!.id), owner, currency, balance: 0n, created_at };
  }

  getAccount(accountId: number): Promise<Account | null> {
    return this.#account(this.#db, accountId);
  }

  async listAccounts(): Promise<Account[]> {
    const { rows } = await this.#db.query(`
      SELECT a.id, a.owner, a.currency, a.created_at, COALESCE(SUM(e.amount), 0) AS balance
      FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
      WHERE a.kind = 'customer'
      GROUP BY a.id, a.owner, a.currency, a.created_at
      ORDER BY a.id`);
    return (rows as Row[]).map((r) => ({ id: id(r.id), owner: r.owner as string, currency: r.currency as Currency, balance: big(r.balance), created_at: r.created_at as string }));
  }

  deposit(accountId: number, amount: bigint, currency: Currency): Promise<Result<Transfer>> {
    return this.apply({ kind: 'deposit', from: null, to: accountId, amount, currency });
  }

  withdraw(accountId: number, amount: bigint, currency: Currency): Promise<Result<Transfer>> {
    return this.apply({ kind: 'withdrawal', from: accountId, to: null, amount, currency });
  }

  transfer(fromId: number, toId: number, amount: bigint, currency: Currency): Promise<Result<Transfer>> {
    return this.apply({ kind: 'transfer', from: fromId, to: toId, amount, currency });
  }

  // A forecast, outside any transaction and without locks: apply() checks again.
  check(m: Movement): Promise<Refusal | null> {
    return this.#check(this.#db, m);
  }

  // One transfer row and two entries, all or nothing (BK-R13), with the rules checked under the
  // locks that make the check still true when the rows are written (BK-R24).
  async apply(m: Movement, key?: string): Promise<Result<Transfer>> {
    return this.#transaction(async (c): Promise<Result<Transfer>> => {
      // Already held when this runs inside an exclusive section; taking them again is a no-op.
      await this.#lock(c, m);
      const refusal = await this.#check(c, m);
      if (refusal) return refusal;
      const fundingId = await this.#fundingAccount(c, m.currency);
      const fromId = m.from ?? fundingId;
      const toId = m.to ?? fundingId;
      const created_at = this.#now();
      const transfer = await this.#one(c, `
        INSERT INTO transfers (kind, from_account_id, to_account_id, amount, currency, created_at, reference)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [m.kind, fromId, toId, m.amount, m.currency, created_at, m.reference ?? null]);
      const transferId = id(transfer!.id);
      const entry = 'INSERT INTO ledger_entries (transfer_id, account_id, amount, currency) VALUES ($1, $2, $3, $4)';
      await c.query(entry, [transferId, fromId, -m.amount, m.currency]);
      await c.query(entry, [transferId, toId, m.amount, m.currency]);
      if (key !== undefined) {
        const linked = await c.query('UPDATE idempotency_keys SET transfer_id = $1 WHERE key = $2 AND transfer_id IS NULL', [transferId, key]);
        if (linked.rowCount !== 1) throw new Error(`idempotency key ${key} is no longer claimed`);
      }
      return { ok: true as const, value: { id: transferId, kind: m.kind, from_account_id: m.from, to_account_id: m.to, amount: m.amount, currency: m.currency, reference: m.reference ?? null, created_at } };
    });
  }

  // As in the SQLite ledger, with one more case: two claims of a new key at once. The second
  // INSERT waits for the first to commit, does nothing, and the key is then read as it is.
  async claimKey(key: string, fingerprint: string): Promise<Claim> {
    return this.#transaction(async (c): Promise<Claim> => {
      const expired = new Date(Date.parse(this.#now()) - KEY_TTL_MS).toISOString();
      await c.query('DELETE FROM idempotency_keys WHERE created_at <= $1', [expired]);
      // The key is either claimed here or read as it is. Released again between the two statements
      // (its request was refused), it is free: try the claim again. Each try waits for the claim it
      // lost to, so a few are always enough.
      for (let attempt = 0; attempt < 5; attempt++) {
        const claimed = await this.#one(c, `
          INSERT INTO idempotency_keys (key, fingerprint, transfer_id, created_at) VALUES ($1, $2, NULL, $3)
          ON CONFLICT (key) DO NOTHING RETURNING key`, [key, fingerprint, this.#now()]);
        if (claimed) return { state: 'claimed' };
        const row = await this.#one(c, 'SELECT fingerprint, transfer_id FROM idempotency_keys WHERE key = $1', [key]);
        if (!row) continue;
        if (row.fingerprint !== fingerprint) return { state: 'mismatch' };
        if (row.transfer_id === null) return { state: 'in_flight' };
        return { state: 'replay', transfer: (await this.#transfer(c, id(row.transfer_id)))! };
      }
      return { state: 'in_flight' };
    });
  }

  async releaseKey(key: string): Promise<void> {
    await this.#db.query('DELETE FROM idempotency_keys WHERE key = $1 AND transfer_id IS NULL', [key]);
  }

  now(): string {
    return this.#now();
  }

  async cashTotal(accountId: number, kind: 'deposit' | 'withdrawal', since: string): Promise<bigint> {
    const column = kind === 'deposit' ? 'to_account_id' : 'from_account_id';
    const row = await this.#one(this.#db, `SELECT COALESCE(SUM(amount), 0) AS total FROM transfers WHERE ${column} = $1 AND kind = $2 AND created_at > $3`, [accountId, kind, since]);
    return big(row!.total);
  }

  async recordDecision(m: Movement, decision: Decision, rule: string | null, detail: string): Promise<ScreeningDecision> {
    const decided_at = this.#now();
    const row = await this.#one(this.#db, `
      INSERT INTO screening_decisions (decided_at, kind, from_account_id, to_account_id, amount, currency, decision, rule, detail)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [decided_at, m.kind, m.from, m.to, m.amount, m.currency, decision, rule, detail]);
    return { id: id(row!.id), decided_at, kind: m.kind, from_account_id: m.from, to_account_id: m.to, amount: m.amount, currency: m.currency, decision, rule, detail };
  }

  async decisions(): Promise<ScreeningDecision[]> {
    const { rows } = await this.#db.query('SELECT * FROM screening_decisions ORDER BY id');
    return (rows as Row[]).map((r) => ({
      id: id(r.id), decided_at: r.decided_at as string, kind: r.kind as Kind,
      from_account_id: optionalId(r.from_account_id), to_account_id: optionalId(r.to_account_id),
      amount: big(r.amount), currency: r.currency as Currency, decision: r.decision as Decision,
      rule: (r.rule as string | null) ?? null, detail: r.detail as string,
    }));
  }

  getTransfer(transferId: number): Promise<TransferWithEntries | null> {
    return this.#transfer(this.#db, transferId);
  }

  async #transfer(c: Client, transferId: number): Promise<TransferWithEntries | null> {
    const row = await this.#one(c, `
      SELECT t.id, t.kind, t.amount, t.currency, t.created_at, t.reference,
             CASE WHEN f.kind = 'funding' THEN NULL ELSE t.from_account_id END AS from_account_id,
             CASE WHEN o.kind = 'funding' THEN NULL ELSE t.to_account_id END AS to_account_id
      FROM transfers t
      JOIN accounts f ON f.id = t.from_account_id
      JOIN accounts o ON o.id = t.to_account_id
      WHERE t.id = $1`, [transferId]);
    if (!row) return null;
    const { rows: entries } = await c.query(`
      SELECT CASE WHEN a.kind = 'funding' THEN NULL ELSE e.account_id END AS account_id, e.amount
      FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transfer_id = $1 ORDER BY e.id`, [transferId]);
    return {
      id: id(row.id), kind: row.kind as Kind,
      from_account_id: optionalId(row.from_account_id), to_account_id: optionalId(row.to_account_id),
      amount: big(row.amount), currency: row.currency as Currency, reference: (row.reference as string | null) ?? null, created_at: row.created_at as string,
      entries: (entries as Row[]).map((e) => ({ account_id: optionalId(e.account_id), amount: big(e.amount) })),
    };
  }

  async statement(accountId: number): Promise<Entry[]> {
    const { rows } = await this.#db.query(`
      SELECT e.id, e.transfer_id, t.kind, e.amount, t.created_at,
             SUM(e.amount) OVER (ORDER BY e.id) AS balance_after,
             CASE WHEN t.kind <> 'transfer' THEN NULL
                  WHEN t.from_account_id = e.account_id THEN t.to_account_id
                  ELSE t.from_account_id END AS counterparty_account_id
      FROM ledger_entries e JOIN transfers t ON t.id = e.transfer_id
      WHERE e.account_id = $1
      ORDER BY e.id`, [accountId]);
    return (rows as Row[]).map((r) => ({
      id: id(r.id), transfer_id: id(r.transfer_id), kind: r.kind as Kind,
      counterparty_account_id: optionalId(r.counterparty_account_id),
      amount: big(r.amount), balance_after: big(r.balance_after), created_at: r.created_at as string,
    }));
  }
}
