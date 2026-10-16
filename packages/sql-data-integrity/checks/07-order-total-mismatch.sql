-- id: order_total_mismatch
-- severity: error
-- description: Order total doesn't equal the sum of quantity x unit price of its items
SELECT o.id AS order_id, o.total_cents, SUM(i.quantity * i.unit_price_cents) AS items_total_cents
FROM orders o
JOIN order_items i ON i.order_id = o.id
GROUP BY o.id
HAVING o.total_cents <> SUM(i.quantity * i.unit_price_cents);
