-- Applies cleanly; its down part changes the table, then fails: the change must not survive.
-- up
ALTER TABLE products ADD COLUMN sku text;
-- down
ALTER TABLE products DROP COLUMN sku;
SELECT 1 / 0;
