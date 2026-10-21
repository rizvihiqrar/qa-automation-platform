import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { MAX_MINOR, formatAmount, type Currency } from './money.ts';

const SCHEMA = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');

// How long a connection waits for another process's write before giving up (BK-R25).
export const BUSY_TIMEOUT_MS = 5000;
// How long an idempotency key is kept after its first use (BK-R23).
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;

export type Kind = 'deposit' | 'withdrawal' | 'transfer';

export interface Account {
  id: number;
  owner: string;
  currency: Currency;
  balance: bigint;
  created_at: string;
}

export interface Transfer {
  id: number;
  kind: Kind;
  // null on the funding side of a deposit or withdrawal: funding accounts are internal (BK-R14)
  from_account_id: number | null;
  to_account_id: number | null;
  amount: bigint;
  currency: Currency;
  created_at: string;
}

export interface Entry {
  id: number;
  transfer_id: number;
  kind: Kind;
  counterparty_account_id: number | null;
  amount: bigint;
  balance_after: bigint;
  created_at: string;
}

// A money movement as asked for. `null` is the currency's funding account: the source
// of a deposit, the destination of a withdrawal.
export interface Movement {
  kind: Kind;
  from: number | null;
  to: number | null;
  amount: bigint;
  currency: Currency;
}

export interface Refusal {
  ok: false;
  status: 404 | 422;
  code: 'not_found' | 'same_account' | 'currency_mismatch' | 'insufficient_funds' | 'limit_exceeded';
  error: string;
}
export type Result<T> = { ok: true; value: T } | Refusal;

// What a keyed request finds when it claims its key (BK-R20, BK-R21).
export type Claim =
  | { state: 'claimed' }
  | { state: 'replay'; transfer: Transfer }
  | { state: 'mismatch' }
  | { state: 'in_flight' };

const refuse = (status: Refusal['status'], code: Refusal['code'], error: string): Refusal => ({ ok: false, status, code, error });

type Row = Record<string, unknown>;
const id = (v: unknown): number => Number(v);
const optionalId = (v: unknown): number | null => (v === null ? null : Number(v));

// The ledger over one SQLite database (`:memory:` unless a file is given). Every
// write is synchronous inside one transaction, so a request sees either all of a
// money movement or none of it (BK-R13). Several processes may open the same file:
// BEGIN IMMEDIATE makes their writes take turns, and the busy timeout makes a
// connection wait its turn instead of failing (BK-R24, BK-R25).
export class Ledger {
  readonly db: DatabaseSync;
  readonly #now: () => string;
  readonly #statements = new Map<string, StatementSync>();

  constructor(path = ':memory:', now = () => new Date().toISOString(), busyTimeoutMs = BUSY_TIMEOUT_MS) {
    this.db = new DatabaseSync(path, { timeout: busyTimeoutMs });
    this.db.exec('PRAGMA foreign_keys = ON');
    this.#write(() => this.db.exec(SCHEMA));
    this.#now = now;
  }

  close(): void {
    this.db.close();
  }

  // Integers come back as BigInt, so no amount ever passes through a double.
  #sql(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      statement.setReadBigInts(true);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  // One write transaction. IMMEDIATE takes the write lock before the first read, so
  // what is read inside can't change before the write (BK-R24).
  #write<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw err;
    }
  }

  #balance(accountId: number): bigint {
    const row = this.#sql('SELECT COALESCE(SUM(amount), 0) AS balance FROM ledger_entries WHERE account_id = ?').get(accountId);
    return row?.balance as bigint;
  }

  // Money in a currency is what its funding account has paid out (BK-R06).
  #issued(currency: Currency): bigint {
    const row = this.#sql(`
      SELECT COALESCE(-SUM(e.amount), 0) AS issued
      FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
      WHERE a.kind = 'funding' AND a.currency = ?`).get(currency);
    return row?.issued as bigint;
  }

  #fundingAccount(currency: Currency): number {
    const row = this.#sql("SELECT id FROM accounts WHERE kind = 'funding' AND currency = ?").get(currency);
    if (row) return id(row.id);
    const created = this.#sql("INSERT INTO accounts (kind, owner, currency, created_at) VALUES ('funding', 'Funding', ?, ?)").run(currency, this.#now());
    return id(created.lastInsertRowid);
  }

  openAccount(owner: string, currency: Currency): Account {
    const created_at = this.#now();
    const row = this.#sql("INSERT INTO accounts (kind, owner, currency, created_at) VALUES ('customer', ?, ?, ?)").run(owner, currency, created_at);
    return { id: id(row.lastInsertRowid), owner, currency, balance: 0n, created_at };
  }

  // Customer accounts only: a funding account is not found through the API.
  getAccount(accountId: number): Account | null {
    const row = this.#sql("SELECT id, owner, currency, created_at FROM accounts WHERE id = ? AND kind = 'customer'").get(accountId);
    if (!row) return null;
    return { id: id(row.id), owner: row.owner as string, currency: row.currency as Currency, balance: this.#balance(id(row.id)), created_at: row.created_at as string };
  }

  // Customer accounts, oldest first, with balances summed from the entries (BK-R31).
  listAccounts(): Account[] {
    const rows = this.#sql(`
      SELECT a.id, a.owner, a.currency, a.created_at, COALESCE(SUM(e.amount), 0) AS balance
      FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
      WHERE a.kind = 'customer'
      GROUP BY a.id, a.owner, a.currency, a.created_at
      ORDER BY a.id`).all();
    return rows.map((r: Row) => ({ id: id(r.id), owner: r.owner as string, currency: r.currency as Currency, balance: r.balance as bigint, created_at: r.created_at as string }));
  }

  deposit(accountId: number, amount: bigint, currency: Currency): Result<Transfer> {
    return this.apply({ kind: 'deposit', from: null, to: accountId, amount, currency });
  }

  withdraw(accountId: number, amount: bigint, currency: Currency): Result<Transfer> {
    return this.apply({ kind: 'withdrawal', from: accountId, to: null, amount, currency });
  }

  transfer(fromId: number, toId: number, amount: bigint, currency: Currency): Result<Transfer> {
    return this.apply({ kind: 'transfer', from: fromId, to: toId, amount, currency });
  }

  // Whether the movement would be refused, without writing anything. Refusal order
  // (BK-R16): unknown account, same account, currency, then funds or the limit. A
  // passing check outside a transaction is only a forecast: apply() checks again.
  check(m: Movement): Refusal | null {
    const from = m.from === null ? null : this.getAccount(m.from);
    if (m.from !== null && !from) return refuse(404, 'not_found', `account ${m.from} not found`);
    const to = m.to === null ? null : this.getAccount(m.to);
    if (m.to !== null && !to) return refuse(404, 'not_found', `account ${m.to} not found`);
    if (from && to && from.id === to.id) return refuse(422, 'same_account', 'cannot transfer from an account to itself');
    for (const account of [from, to]) {
      if (account && account.currency !== m.currency) return mismatch(account, m.currency);
    }
    if (from) {
      if (from.balance < m.amount) {
        return refuse(422, 'insufficient_funds', `insufficient funds: balance is ${formatAmount(from.balance, m.currency)}, amount is ${formatAmount(m.amount, m.currency)}`);
      }
    } else if (this.#issued(m.currency) + m.amount > MAX_MINOR) {
      return refuse(422, 'limit_exceeded', `deposit would take the ${m.currency} held by all accounts past ${formatAmount(MAX_MINOR, m.currency)}`);
    }
    return null;
  }

  // One transfer row and two entries, all or nothing (BK-R13). The check runs again
  // inside the transaction, after any wait the caller had, so two movements at once
  // can't both spend the same money (BK-R24). With a key, the key is linked to the
  // transfer in the same transaction (BK-R22).
  apply(m: Movement, key?: string): Result<Transfer> {
    return this.#write(() => {
      const refusal = this.check(m);
      if (refusal) return refusal;
      const fundingId = this.#fundingAccount(m.currency);
      const fromId = m.from ?? fundingId;
      const toId = m.to ?? fundingId;
      const created_at = this.#now();
      const transfer = this.#sql('INSERT INTO transfers (kind, from_account_id, to_account_id, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(m.kind, fromId, toId, m.amount, m.currency, created_at);
      const transferId = id(transfer.lastInsertRowid);
      const entry = this.#sql('INSERT INTO ledger_entries (transfer_id, account_id, amount, currency) VALUES (?, ?, ?, ?)');
      entry.run(transferId, fromId, -m.amount, m.currency);
      entry.run(transferId, toId, m.amount, m.currency);
      if (key !== undefined) {
        const linked = this.#sql('UPDATE idempotency_keys SET transfer_id = ? WHERE key = ? AND transfer_id IS NULL').run(transferId, key);
        if (Number(linked.changes) !== 1) throw new Error(`idempotency key ${key} is no longer claimed`);
      }
      return { ok: true as const, value: { id: transferId, kind: m.kind, from_account_id: m.from, to_account_id: m.to, amount: m.amount, currency: m.currency, created_at } };
    });
  }

  // Claims a key for a request, or says what the key already belongs to: the same
  // request done (replay), the same request still running (in flight), or another
  // request (mismatch). Keys past their 24 hours are deleted first (BK-R23).
  claimKey(key: string, fingerprint: string): Claim {
    return this.#write((): Claim => {
      const expired = new Date(Date.parse(this.#now()) - KEY_TTL_MS).toISOString();
      this.#sql('DELETE FROM idempotency_keys WHERE created_at <= ?').run(expired);
      const row = this.#sql('SELECT fingerprint, transfer_id FROM idempotency_keys WHERE key = ?').get(key);
      if (!row) {
        this.#sql('INSERT INTO idempotency_keys (key, fingerprint, transfer_id, created_at) VALUES (?, ?, NULL, ?)').run(key, fingerprint, this.#now());
        return { state: 'claimed' };
      }
      if (row.fingerprint !== fingerprint) return { state: 'mismatch' };
      if (row.transfer_id === null) return { state: 'in_flight' };
      return { state: 'replay', transfer: this.getTransfer(id(row.transfer_id))! };
    });
  }

  // Gives up a claim that never got its transfer, so the key can be tried again (BK-R22).
  releaseKey(key: string): void {
    this.#write(() => this.#sql('DELETE FROM idempotency_keys WHERE key = ? AND transfer_id IS NULL').run(key));
  }

  getTransfer(transferId: number): (Transfer & { entries: { account_id: number | null; amount: bigint }[] }) | null {
    const row = this.#sql(`
      SELECT t.id, t.kind, t.amount, t.currency, t.created_at,
             CASE WHEN f.kind = 'funding' THEN NULL ELSE t.from_account_id END AS from_account_id,
             CASE WHEN o.kind = 'funding' THEN NULL ELSE t.to_account_id END AS to_account_id
      FROM transfers t
      JOIN accounts f ON f.id = t.from_account_id
      JOIN accounts o ON o.id = t.to_account_id
      WHERE t.id = ?`).get(transferId);
    if (!row) return null;
    const entries = this.#sql(`
      SELECT CASE WHEN a.kind = 'funding' THEN NULL ELSE e.account_id END AS account_id, e.amount
      FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transfer_id = ? ORDER BY e.id`).all(transferId);
    return {
      id: id(row.id), kind: row.kind as Kind,
      from_account_id: optionalId(row.from_account_id), to_account_id: optionalId(row.to_account_id),
      amount: row.amount as bigint, currency: row.currency as Currency, created_at: row.created_at as string,
      entries: entries.map((e: Row) => ({ account_id: optionalId(e.account_id), amount: e.amount as bigint })),
    };
  }

  // Oldest first, each with the balance after it (BK-R15).
  statement(accountId: number): Entry[] {
    const rows = this.#sql(`
      SELECT e.id, e.transfer_id, t.kind, e.amount, t.created_at,
             SUM(e.amount) OVER (ORDER BY e.id) AS balance_after,
             CASE WHEN t.kind <> 'transfer' THEN NULL
                  WHEN t.from_account_id = e.account_id THEN t.to_account_id
                  ELSE t.from_account_id END AS counterparty_account_id
      FROM ledger_entries e JOIN transfers t ON t.id = e.transfer_id
      WHERE e.account_id = ?
      ORDER BY e.id`).all(accountId);
    return rows.map((r: Row) => ({
      id: id(r.id), transfer_id: id(r.transfer_id), kind: r.kind as Kind,
      counterparty_account_id: optionalId(r.counterparty_account_id),
      amount: r.amount as bigint, balance_after: r.balance_after as bigint, created_at: r.created_at as string,
    }));
  }
}

const mismatch = (account: Account, currency: Currency): Refusal =>
  refuse(422, 'currency_mismatch', `account ${account.id} holds ${account.currency}, not ${currency}`);
