-- A realistic batch of bad data on top of the clean seed, the kind that arrives
-- through a botched import or a manual fix in production. Used by `--dataset demo`.

-- An import created a second account for an existing customer, with different casing.
INSERT INTO customers (id, email, full_name, created_at) VALUES
  (6, 'Ben.Okafor@Example.com', 'Benjamin Okafor', '2026-04-10T12:00:00Z');

-- A typo left an address without a domain.
UPDATE customers SET email = 'chloe.tran@example' WHERE id = 3;

-- A price change was applied to the order total but not to its items.
UPDATE orders SET total_cents = 5197 WHERE id = 1;

-- A refund was keyed against the wrong order id, which doesn't exist.
INSERT INTO payments (id, order_id, amount_cents, paid_at) VALUES
  (7, 70, 2999, '2026-03-26T10:00:00Z');

-- The cancelled order was charged anyway.
INSERT INTO payments (id, order_id, amount_cents, paid_at) VALUES
  (8, 5, 2999, '2026-03-25T13:05:00Z');

-- A warehouse sync marked an order delivered before it was placed.
UPDATE orders SET shipped_at = '2026-03-27T09:00:00Z' WHERE id = 6;
