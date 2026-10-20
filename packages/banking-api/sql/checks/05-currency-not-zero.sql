-- id: currency_not_zero
-- severity: error
-- description: The entries in a currency don't sum to zero (BK-R26)
SELECT e.currency, SUM(e.amount) AS total
FROM ledger_entries e
GROUP BY e.currency
HAVING SUM(e.amount) <> 0;
