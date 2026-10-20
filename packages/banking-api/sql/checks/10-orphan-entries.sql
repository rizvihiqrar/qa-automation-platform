-- id: orphan_entries
-- severity: error
-- description: A ledger entry points at a transfer or an account that doesn't exist (BK-R28)
SELECT e.id AS entry_id, e.transfer_id, e.account_id
FROM ledger_entries e
LEFT JOIN transfers t ON t.id = e.transfer_id
LEFT JOIN accounts a ON a.id = e.account_id
WHERE t.id IS NULL OR a.id IS NULL;
