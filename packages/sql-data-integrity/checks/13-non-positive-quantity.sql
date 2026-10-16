-- id: non_positive_quantity
-- severity: error
-- description: Order items with a quantity of zero or less
SELECT id AS item_id, order_id, quantity
FROM order_items
WHERE quantity <= 0;
