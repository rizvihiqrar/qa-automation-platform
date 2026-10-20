-- id: orphan_transfers
-- severity: error
-- description: A transfer points at an account that doesn't exist (BK-R28)
SELECT t.id AS transfer_id, t.from_account_id, t.to_account_id
FROM transfers t
LEFT JOIN accounts f ON f.id = t.from_account_id
LEFT JOIN accounts o ON o.id = t.to_account_id
WHERE f.id IS NULL OR o.id IS NULL;
