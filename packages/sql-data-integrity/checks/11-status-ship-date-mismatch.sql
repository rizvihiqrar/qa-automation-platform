-- id: status_ship_date_mismatch
-- severity: error
-- description: Shipped or delivered orders without a ship date, or other orders that have one
SELECT id AS order_id, status, shipped_at
FROM orders
WHERE (status IN ('shipped', 'delivered') AND shipped_at IS NULL)
   OR (status NOT IN ('shipped', 'delivered') AND shipped_at IS NOT NULL);
