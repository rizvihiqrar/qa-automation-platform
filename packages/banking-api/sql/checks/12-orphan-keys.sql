-- id: orphan_keys
-- severity: error
-- description: An idempotency key points at a transfer that doesn't exist (BK-R28)
SELECT k.key, k.transfer_id
FROM idempotency_keys k
LEFT JOIN transfers t ON t.id = k.transfer_id
WHERE k.transfer_id IS NOT NULL AND t.id IS NULL;
