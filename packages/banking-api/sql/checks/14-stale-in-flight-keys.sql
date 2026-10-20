-- id: stale_in_flight_keys
-- severity: warning
-- description: An idempotency key has been in flight for over 10 minutes: its request most likely stopped and left the key blocked (BK-R29)
-- :stale_before is filled in by the runner: the time 10 minutes before now.
SELECT k.key, k.created_at
FROM idempotency_keys k
WHERE k.transfer_id IS NULL AND k.created_at < :stale_before;
