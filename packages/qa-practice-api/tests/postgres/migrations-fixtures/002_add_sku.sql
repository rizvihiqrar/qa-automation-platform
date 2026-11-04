-- A second migration that changes a table that already holds rows: adds a column and fills it.
-- up
ALTER TABLE products ADD COLUMN sku text;
UPDATE products SET sku = 'P' || id;
-- down
ALTER TABLE products DROP COLUMN sku;
