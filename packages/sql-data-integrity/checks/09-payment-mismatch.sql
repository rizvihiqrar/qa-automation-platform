-- id: payment_mismatch
-- severity: error
-- description: Paid orders (processing, shipped, delivered) not paid exactly their items total, or pending/cancelled orders with payments
-- Compares payments with the items total, not orders.total_cents, so a wrong
-- order total is reported once (by order_total_mismatch) instead of twice.
WITH item_totals AS (
  SELECT order_id, SUM(quantity * unit_price_cents) AS items_total_cents
  FROM order_items GROUP BY order_id
),
paid AS (
  SELECT order_id, SUM(amount_cents) AS paid_cents
  FROM payments GROUP BY order_id
)
SELECT o.id AS order_id, o.status,
       CASE WHEN o.status IN ('pending', 'cancelled') THEN 0 ELSE COALESCE(t.items_total_cents, 0) END AS expected_cents,
       COALESCE(p.paid_cents, 0)        AS paid_cents
FROM orders o
LEFT JOIN item_totals t ON t.order_id = o.id
LEFT JOIN paid p        ON p.order_id = o.id
WHERE (o.status IN ('processing', 'shipped', 'delivered') AND COALESCE(p.paid_cents, 0) <> COALESCE(t.items_total_cents, 0))
   OR (o.status IN ('pending', 'cancelled') AND COALESCE(p.paid_cents, 0) <> 0);
