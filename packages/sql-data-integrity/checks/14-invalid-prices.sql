-- id: invalid_prices
-- severity: error
-- description: Products priced at zero or less, or order items with a negative unit price
SELECT 'product' AS source, id, price_cents AS price_cents FROM products WHERE price_cents <= 0
UNION ALL
SELECT 'order_item' AS source, id, unit_price_cents FROM order_items WHERE unit_price_cents < 0;
