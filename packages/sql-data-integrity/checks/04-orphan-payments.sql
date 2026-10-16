-- id: orphan_payments
-- severity: error
-- description: Payments recorded against an order that doesn't exist
SELECT p.id AS payment_id, p.order_id, p.amount_cents
FROM payments p
LEFT JOIN orders o ON o.id = p.order_id
WHERE o.id IS NULL;
