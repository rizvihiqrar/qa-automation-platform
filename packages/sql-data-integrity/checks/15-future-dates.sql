-- id: future_dates
-- severity: warning
-- description: Orders, payments or customers dated in the future
SELECT 'order' AS source, id, ordered_at AS date FROM orders WHERE ordered_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
UNION ALL
SELECT 'payment', id, paid_at FROM payments WHERE paid_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
UNION ALL
SELECT 'customer', id, created_at FROM customers WHERE created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now');
