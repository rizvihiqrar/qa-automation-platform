-- id: unknown_status
-- severity: error
-- description: Orders with a status outside pending, processing, shipped, delivered, cancelled
SELECT id AS order_id, status
FROM orders
WHERE status NOT IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
