-- Changes the table, then fails: the change must not survive.
-- up
ALTER TABLE products ADD COLUMN sku text;
SELECT 1 / 0;
-- down
ALTER TABLE products DROP COLUMN sku;
