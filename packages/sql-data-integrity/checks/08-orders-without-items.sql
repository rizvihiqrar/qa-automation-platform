-- id: orders_without_items
-- severity: error
-- description: Orders with no items at all
SELECT o.id AS order_id, o.status, o.total_cents
FROM orders o
LEFT JOIN order_items i ON i.order_id = o.id
WHERE i.id IS NULL;
