-- id: transfer_not_balanced
-- severity: error
-- description: A transfer's entries don't sum to zero (BK-R26)
SELECT e.transfer_id, SUM(e.amount) AS total
FROM ledger_entries e
GROUP BY e.transfer_id
HAVING SUM(e.amount) <> 0;
