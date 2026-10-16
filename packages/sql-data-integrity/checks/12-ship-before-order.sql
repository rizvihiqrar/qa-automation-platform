-- id: ship_before_order
-- severity: error
-- description: Orders shipped before they were placed
SELECT id AS order_id, ordered_at, shipped_at
FROM orders
WHERE shipped_at IS NOT NULL AND shipped_at < ordered_at;
