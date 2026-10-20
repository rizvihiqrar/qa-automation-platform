-- id: negative_balance
-- severity: error
-- description: A customer account's balance is below zero (BK-R27)
SELECT a.id AS account_id, SUM(e.amount) AS balance
FROM accounts a
JOIN ledger_entries e ON e.account_id = a.id
WHERE a.kind = 'customer'
GROUP BY a.id
HAVING SUM(e.amount) < 0;
