-- id: overdrawn_in_history
-- severity: error
-- description: A customer account's running balance went below zero at some entry, even if it was refilled later (BK-R27)
-- Entries are in the order they were written: ids follow commit order, because each
-- write holds the lock for the whole database (SQLite) or the account (Postgres).
SELECT running.account_id, running.entry_id, running.balance_after
FROM (
  SELECT e.account_id, e.id AS entry_id,
         SUM(e.amount) OVER (PARTITION BY e.account_id ORDER BY e.id) AS balance_after
  FROM ledger_entries e
  JOIN accounts a ON a.id = e.account_id
  WHERE a.kind = 'customer'
) running
WHERE running.balance_after < 0;
