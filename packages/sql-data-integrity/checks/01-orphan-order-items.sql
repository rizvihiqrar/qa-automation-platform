-- id: orphan_order_items
-- severity: error
-- description: Order items that point to an order that doesn't exist
SELECT i.id AS item_id, i.order_id
FROM order_items i
LEFT JOIN orders o ON o.id = i.order_id
WHERE o.id IS NULL;
