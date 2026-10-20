-- id: currency_limit
-- severity: error
-- description: The money held in a currency, by all accounts together, is past 99,999,999,999,999,999 minor units (BK-R27)
-- Money in a currency is what its funding account has paid out.
SELECT a.currency, -SUM(e.amount) AS issued
FROM ledger_entries e
JOIN accounts a ON a.id = e.account_id
WHERE a.kind = 'funding'
GROUP BY a.currency
HAVING -SUM(e.amount) > 99999999999999999;
