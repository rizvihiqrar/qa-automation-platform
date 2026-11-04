-- Changes the table and writes its own version row, so the runner's own insert of version 2 then
-- fails. The change was already made by then: only a transaction around both can undo it.
-- up
ALTER TABLE products ADD COLUMN sku text;
INSERT INTO schema_migrations (version, name) VALUES (2, 'records_itself');
-- down
ALTER TABLE products DROP COLUMN sku;
