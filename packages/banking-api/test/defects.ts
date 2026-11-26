// The defects that prove the SQL ledger checks, each put into the sample ledger (src/sample.ts)
// past the API with foreign keys off. Used by checks.test.ts on SQLite and postgres.test.ts on
// Postgres: the same SQL, the same expected checks.
//
// Sample ids: accounts 1 Ada, 2 Bo (CAD), 4 Chiyo (JPY), 6 Dana, 7 Eli (USD), 9 Faris
// (KWD); funding 3 CAD, 5 JPY, 8 USD, 10 KWD. Transfer 4 is Ada to Bo, 10.00, keyed
// rent-2026-10, entries 7 (debit) and 8 (credit). Dana's balance is 0, Faris holds the
// KWD limit exactly, and the key in-flight was claimed at 12:00:22, before SAMPLE_NOW.
export const DEFECTS: { name: string; rule: string; sql: string; expect: string[] }[] = [
  { name: 'a transfer lost its credit', rule: 'BK-R26', sql: 'DELETE FROM ledger_entries WHERE id = 8;', expect: ['currency_not_zero', 'transfer_entry_count', 'transfer_not_balanced'] },
  { name: 'a third entry, written twice by a retry', rule: 'BK-R26', sql: "INSERT INTO ledger_entries VALUES (19, 4, 2, 1000, 'CAD');", expect: ['currency_not_zero', 'transfer_entry_count', 'transfer_not_balanced'] },
  { name: 'two extra entries that cancel out', rule: 'BK-R26', sql: "INSERT INTO ledger_entries VALUES (19, 4, 1, -500, 'CAD'), (20, 4, 2, 500, 'CAD');", expect: ['entry_mismatch', 'transfer_entry_count'] },
  { name: 'a credit one cent too high', rule: 'BK-R26', sql: 'UPDATE ledger_entries SET amount = 1001 WHERE id = 8;', expect: ['currency_not_zero', 'entry_mismatch', 'transfer_not_balanced'] },
  { name: 'the debit and the credit swapped', rule: 'BK-R26', sql: 'UPDATE ledger_entries SET amount = -amount WHERE transfer_id = 2;', expect: ['entry_mismatch', 'negative_balance', 'overdrawn_in_history'] },
  { name: 'a credit to the wrong account, in another currency', rule: 'BK-R26', sql: 'UPDATE ledger_entries SET account_id = 7 WHERE id = 8;', expect: ['currency_mismatch', 'entry_mismatch'] },
  { name: 'an entry in the wrong currency', rule: 'BK-R26', sql: "UPDATE ledger_entries SET currency = 'USD' WHERE id = 10;", expect: ['currency_mismatch', 'currency_not_zero'] },
  { name: 'a transfer row in the wrong currency', rule: 'BK-R26', sql: "UPDATE transfers SET currency = 'USD' WHERE id = 5;", expect: ['currency_mismatch'] },
  { name: 'an account\'s currency changed after it was used', rule: 'BK-R26', sql: "UPDATE accounts SET currency = 'USD' WHERE id = 4;", expect: ['currency_mismatch'] },
  {
    name: 'a withdrawal from an empty account', rule: 'BK-R27',
    sql: "INSERT INTO transfers (id, kind, from_account_id, to_account_id, amount, currency, created_at) VALUES (10, 'withdrawal', 6, 8, 1, 'USD', '2026-10-20T12:01:00.000Z'); INSERT INTO ledger_entries VALUES (19, 10, 6, -1, 'USD'), (20, 10, 8, 1, 'USD');",
    expect: ['negative_balance', 'overdrawn_in_history'],
  },
  {
    name: 'an overdraft refilled a second later', rule: 'BK-R27',
    sql: `INSERT INTO transfers (id, kind, from_account_id, to_account_id, amount, currency, created_at) VALUES (10, 'withdrawal', 6, 8, 1, 'USD', '2026-10-20T12:01:00.000Z'); INSERT INTO ledger_entries VALUES (19, 10, 6, -1, 'USD'), (20, 10, 8, 1, 'USD');
          INSERT INTO transfers (id, kind, from_account_id, to_account_id, amount, currency, created_at) VALUES (11, 'deposit', 8, 6, 1, 'USD', '2026-10-20T12:01:01.000Z'); INSERT INTO ledger_entries VALUES (21, 11, 8, -1, 'USD'), (22, 11, 6, 1, 'USD');`,
    expect: ['overdrawn_in_history'],
  },
  {
    name: 'one fils past the currency limit', rule: 'BK-R27',
    sql: "INSERT INTO transfers (id, kind, from_account_id, to_account_id, amount, currency, created_at) VALUES (10, 'deposit', 10, 9, 1, 'KWD', '2026-10-20T12:01:00.000Z'); INSERT INTO ledger_entries VALUES (19, 10, 10, -1, 'KWD'), (20, 10, 9, 1, 'KWD');",
    expect: ['currency_limit'],
  },
  { name: 'a transfer recorded as a deposit', rule: 'BK-R27', sql: "UPDATE transfers SET kind = 'deposit' WHERE id = 2;", expect: ['wrong_account_kind'] },
  { name: 'a deposit recorded as a transfer', rule: 'BK-R27', sql: "UPDATE transfers SET kind = 'transfer' WHERE id = 1;", expect: ['wrong_account_kind'] },
  { name: 'an entry for an account that doesn\'t exist', rule: 'BK-R28', sql: 'UPDATE ledger_entries SET account_id = 99 WHERE id = 8;', expect: ['entry_mismatch', 'orphan_entries'] },
  { name: 'an entry for a transfer that doesn\'t exist', rule: 'BK-R28', sql: "INSERT INTO ledger_entries VALUES (19, 99, 1, 5, 'CAD');", expect: ['currency_not_zero', 'orphan_entries', 'transfer_not_balanced'] },
  { name: 'an account deleted with its history', rule: 'BK-R28', sql: 'DELETE FROM accounts WHERE id = 7;', expect: ['orphan_entries', 'orphan_transfers'] },
  { name: 'a transfer deleted, its key left behind', rule: 'BK-R28', sql: 'DELETE FROM ledger_entries WHERE transfer_id = 4; DELETE FROM transfers WHERE id = 4;', expect: ['orphan_keys'] },
  {
    // The UNIQUE constraint refuses this (see below), so the table is rebuilt without
    // it first, as a hand-written migration might.
    name: 'a migration dropped UNIQUE, and a second key points at a transfer', rule: 'BK-R28',
    sql: `CREATE TABLE keys_copy (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, transfer_id INTEGER REFERENCES transfers (id), created_at TEXT NOT NULL);
          INSERT INTO keys_copy SELECT * FROM idempotency_keys; DROP TABLE idempotency_keys; ALTER TABLE keys_copy RENAME TO idempotency_keys;
          INSERT INTO idempotency_keys VALUES ('rent-again', 'sample', 4, '2026-10-20T12:01:00.000Z');`,
    expect: ['key_shared_transfer'],
  },
  { name: 'a key in flight for 10 minutes and 1 ms', rule: 'BK-R29', sql: "UPDATE idempotency_keys SET created_at = '2026-10-20T11:54:59.999Z' WHERE key = 'in-flight';", expect: ['stale_in_flight_keys'] },
  { name: 'a key in flight for exactly 10 minutes', rule: 'BK-R29', sql: "UPDATE idempotency_keys SET created_at = '2026-10-20T11:55:00.000Z' WHERE key = 'in-flight';", expect: [] },
  { name: 'a linked key a day old', rule: 'BK-R29', sql: "UPDATE idempotency_keys SET created_at = '2026-10-19T12:00:00.000Z' WHERE key = 'rent-2026-10';", expect: [] },
];
