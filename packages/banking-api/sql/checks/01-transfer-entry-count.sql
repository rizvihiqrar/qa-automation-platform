-- id: transfer_entry_count
-- severity: error
-- description: A transfer doesn't have exactly two ledger entries (BK-R26)
SELECT t.id AS transfer_id, COUNT(e.id) AS entries
FROM transfers t
LEFT JOIN ledger_entries e ON e.transfer_id = t.id
GROUP BY t.id
HAVING COUNT(e.id) <> 2;
