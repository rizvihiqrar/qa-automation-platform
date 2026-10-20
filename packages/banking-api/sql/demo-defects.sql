-- Defects put into the sample ledger by hand, bypassing the API, for
-- `npm run check -- --demo`: what a bad migration, a manual fix or a bug that
-- skipped the transaction could leave behind. Foreign keys are off, as they are
-- by default for any other SQLite connection.

-- A manual fix raised a credit by one cent: transfer 4 no longer balances.
UPDATE ledger_entries SET amount = 1001 WHERE id = 8;

-- An overdraft, refilled a second later: the balance is fine now, the history isn't.
INSERT INTO transfers VALUES (10, 'withdrawal', 6, 8, 500, 'USD', '2026-10-20T12:01:00.000Z');
INSERT INTO ledger_entries VALUES (19, 10, 6, -500, 'USD'), (20, 10, 8, 500, 'USD');
INSERT INTO transfers VALUES (11, 'deposit', 8, 6, 500, 'USD', '2026-10-20T12:01:01.000Z');
INSERT INTO ledger_entries VALUES (21, 11, 8, -500, 'USD'), (22, 11, 6, 500, 'USD');

-- A deposit recorded as a transfer.
UPDATE transfers SET kind = 'transfer' WHERE id = 7;

-- A key left pointing at a transfer that was deleted.
UPDATE idempotency_keys SET transfer_id = 99 WHERE key = 'rent-2026-10';

-- A request that stopped an hour ago and left its key in flight.
UPDATE idempotency_keys SET created_at = '2026-10-20T11:00:00.000Z' WHERE key = 'in-flight';
