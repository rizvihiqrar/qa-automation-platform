-- id: orphan_orders
-- severity: error
-- description: Orders that belong to a customer who doesn't exist
SELECT o.id AS order_id, o.customer_id
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
WHERE c.id IS NULL;
