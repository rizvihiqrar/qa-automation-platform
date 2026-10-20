import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { MAX_MINOR, formatAmount, type Currency } from './money.ts';

const SCHEMA = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');

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

export interface Refusal {
  ok: false;
  status: 404 | 422;
  code: 'not_found' | 'same_account' | 'currency_mismatch' | 'insufficient_funds' | 'limit_exceeded';
  error: string;
}
export type Result<T> = { ok: true; value: T } | Refusal;

const refuse = (status: Refusal['status'], code: Refusal['code'], error: string): Refusal => ({ ok: false, status, code, error });

type Row = Record<string, unknown>;
const id = (v: unknown): number => Number(v);
const optionalId = (v: unknown): number | null => (v === null ? null : Number(v));

// The ledger over one SQLite database (`:memory:` unless a file is given). Every
// write is synchronous inside one transaction, so a request sees either all of a
// money movement or none of it (BK-R13).
export class Ledger {
  readonly db: DatabaseSync;
  readonly #now: () => string;
  readonly #statements = new Map<string, StatementSync>();

  constructor(path = ':memory:', now = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
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

  #balance(accountId: number): bigint {
    const row = this.#sql('SELECT COALESCE(SUM(amount), 0) AS balance FROM ledger_entries WHERE account_id = ?').get(accountId);
    return row?.balance as bigint;
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

  deposit(accountId: number, amount: bigint, currency: Currency): Result<Transfer> {
    const account = this.getAccount(accountId);
    if (!account) return refuse(404, 'not_found', `account ${accountId} not found`);
    if (account.currency !== currency) return mismatch(account, currency);
    return this.#move('deposit', null, account, amount, currency);
  }

  withdraw(accountId: number, amount: bigint, currency: Currency): Result<Transfer> {
    const account = this.getAccount(accountId);
    if (!account) return refuse(404, 'not_found', `account ${accountId} not found`);
    if (account.currency !== currency) return mismatch(account, currency);
    return this.#move('withdrawal', account, null, amount, currency);
  }

  // Refusal order (BK-R16): unknown account, same account, currency, then funds.
  transfer(fromId: number, toId: number, amount: bigint, currency: Currency): Result<Transfer> {
    const from = this.getAccount(fromId);
    if (!from) return refuse(404, 'not_found', `account ${fromId} not found`);
    const to = this.getAccount(toId);
    if (!to) return refuse(404, 'not_found', `account ${toId} not found`);
    if (from.id === to.id) return refuse(422, 'same_account', 'cannot transfer from an account to itself');
    if (from.currency !== currency) return mismatch(from, currency);
    if (to.currency !== currency) return mismatch(to, currency);
    return this.#move('transfer', from, to, amount, currency);
  }

  // One transfer row and two entries, all or nothing (BK-R13). `null` is the
  // currency's funding account.
  #move(kind: Kind, from: Account | null, to: Account | null, amount: bigint, currency: Currency): Result<Transfer> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const fundingId = this.#fundingAccount(currency);
      const fromId = from?.id ?? fundingId;
      const toId = to?.id ?? fundingId;

      if (from) {
        const balance = this.#balance(from.id);
        if (balance < amount) {
          this.db.exec('ROLLBACK');
          return refuse(422, 'insufficient_funds', `insufficient funds: balance is ${formatAmount(balance, currency)}, amount is ${formatAmount(amount, currency)}`);
        }
      } else {
        // Money in a currency is what its funding account has paid out (BK-R06).
        const issued = -this.#balance(fundingId);
        if (issued + amount > MAX_MINOR) {
          this.db.exec('ROLLBACK');
          return refuse(422, 'limit_exceeded', `deposit would take the ${currency} held by all accounts past ${formatAmount(MAX_MINOR, currency)}`);
        }
      }

      const created_at = this.#now();
      const transfer = this.#sql('INSERT INTO transfers (kind, from_account_id, to_account_id, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(kind, fromId, toId, amount, currency, created_at);
      const transferId = id(transfer.lastInsertRowid);
      const entry = this.#sql('INSERT INTO ledger_entries (transfer_id, account_id, amount, currency) VALUES (?, ?, ?, ?)');
      entry.run(transferId, fromId, -amount, currency);
      entry.run(transferId, toId, amount, currency);
      this.db.exec('COMMIT');
      return { ok: true, value: { id: transferId, kind, from_account_id: from?.id ?? null, to_account_id: to?.id ?? null, amount, currency, created_at } };
    } catch (err) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw err;
    }
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
