-- Double-entry ledger. Every money movement is one row in transfers and exactly two
-- rows in ledger_entries: a debit (negative) from one account and a credit (positive)
-- of the same amount to another. A balance is the sum of an account's entries; no
-- balance is stored, so none can drift from the ledger (BK-R09, BK-R13).
--
-- Amounts are whole minor units (cents, yen, fils) in INTEGER columns. Kept to SQL
-- that also runs on Postgres (with BIGINT), for Day 49.

CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY,
  kind       TEXT    NOT NULL CHECK (kind IN ('customer', 'funding')),
  owner      TEXT    NOT NULL,
  currency   TEXT    NOT NULL CHECK (currency IN ('CAD', 'USD', 'JPY', 'KWD')),
  created_at TEXT    NOT NULL
);

-- Deposits come from, and withdrawals go to, one funding account per currency
-- (BK-R14), so the entries in each currency always sum to zero.
CREATE UNIQUE INDEX IF NOT EXISTS one_funding_account_per_currency
  ON accounts (currency) WHERE kind = 'funding';

CREATE TABLE IF NOT EXISTS transfers (
  id              INTEGER PRIMARY KEY,
  kind            TEXT    NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'transfer')),
  from_account_id INTEGER NOT NULL REFERENCES accounts (id),
  to_account_id   INTEGER NOT NULL REFERENCES accounts (id),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  currency        TEXT    NOT NULL,
  created_at      TEXT    NOT NULL,
  CHECK (from_account_id <> to_account_id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id          INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES transfers (id),
  account_id  INTEGER NOT NULL REFERENCES accounts (id),
  amount      INTEGER NOT NULL CHECK (amount <> 0),  -- negative: debit, positive: credit
  currency    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_entries_by_account ON ledger_entries (account_id, id);
CREATE INDEX IF NOT EXISTS ledger_entries_by_transfer ON ledger_entries (transfer_id);

-- Idempotency keys (BK-R19 to BK-R23). A keyed request claims its key first
-- (transfer_id NULL: in flight), and the key is linked to its transfer in the same
-- transaction that writes the transfer: a key never points at a transfer that wasn't
-- written, and UNIQUE stops one transfer answering for two keys. A refused request
-- deletes its claim. Keys are deleted 24 hours after first use.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT    PRIMARY KEY,
  fingerprint TEXT    NOT NULL,  -- what was asked: route, accounts, amount, currency
  transfer_id INTEGER UNIQUE REFERENCES transfers (id),
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idempotency_keys_by_age ON idempotency_keys (created_at);
