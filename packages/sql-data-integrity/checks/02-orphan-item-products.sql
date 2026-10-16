-- id: orphan_item_products
-- severity: error
-- description: Order items that point to a product that doesn't exist
SELECT i.id AS item_id, i.product_id
FROM order_items i
LEFT JOIN products p ON p.id = i.product_id
WHERE p.id IS NULL;
