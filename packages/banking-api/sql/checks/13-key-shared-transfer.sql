-- id: key_shared_transfer
-- severity: error
-- description: One transfer answers for two or more idempotency keys (BK-R28)
-- The schema's UNIQUE constraint prevents this; the check is for a database where the
-- constraint was dropped or never made, such as a hand-written migration.
SELECT k.transfer_id, COUNT(*) AS keys
FROM idempotency_keys k
WHERE k.transfer_id IS NOT NULL
GROUP BY k.transfer_id
HAVING COUNT(*) > 1;
