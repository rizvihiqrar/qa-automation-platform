-- A small, fully consistent dataset. Every check must return zero rows against it.
-- Rules it follows:
--   order total = sum(quantity x unit price) of its items
--   processing / shipped / delivered orders are paid in full; pending and cancelled have no payments
--   only shipped / delivered orders have shipped_at, and it is after ordered_at

INSERT INTO customers (id, email, full_name, created_at) VALUES
  (1, 'ana.silva@example.com',   'Ana Silva',   '2026-01-05T10:00:00Z'),
  (2, 'ben.okafor@example.com',  'Ben Okafor',  '2026-01-12T14:30:00Z'),
  (3, 'chloe.tran@example.com',  'Chloe Tran',  '2026-02-02T09:15:00Z'),
  (4, 'dev.patel@example.com',   'Dev Patel',   '2026-02-20T16:45:00Z'),
  (5, 'erin.walsh@example.com',  'Erin Walsh',  '2026-03-01T11:00:00Z');

INSERT INTO products (id, sku, name, price_cents) VALUES
  (1, 'BKP-001', 'Backpack',         2999),
  (2, 'BLT-002', 'Bike Light',        999),
  (3, 'TSH-003', 'T-Shirt',          1599),
  (4, 'JKT-004', 'Fleece Jacket',    4999),
  (5, 'ONS-005', 'Onesie',            799),
  (6, 'TSR-006', 'T-Shirt (Red)',    1599);

-- Order 1: delivered, two items        2999 + 2 x 999        = 4997
-- Order 2: shipped, one item           4999                   = 4999
-- Order 3: processing, two items       1599 + 799             = 2398
-- Order 4: pending, one item           3 x 1599               = 4797
-- Order 5: cancelled, one item         2999                   = 2999
-- Order 6: delivered, three items      799 + 1599 + 999       = 3397
-- Order 7: delivered, split payment    2 x 4999               = 9998
INSERT INTO orders (id, customer_id, status, total_cents, ordered_at, shipped_at) VALUES
  (1, 1, 'delivered',  4997, '2026-03-10T09:00:00Z', '2026-03-11T15:00:00Z'),
  (2, 2, 'shipped',    4999, '2026-03-15T12:00:00Z', '2026-03-16T10:00:00Z'),
  (3, 3, 'processing', 2398, '2026-03-20T08:30:00Z', NULL),
  (4, 4, 'pending',    4797, '2026-03-22T19:00:00Z', NULL),
  (5, 1, 'cancelled',  2999, '2026-03-25T13:00:00Z', NULL),
  (6, 5, 'delivered',  3397, '2026-03-28T10:00:00Z', '2026-03-29T09:30:00Z'),
  (7, 2, 'delivered',  9998, '2026-04-02T17:00:00Z', '2026-04-04T08:00:00Z');

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents) VALUES
  (1,  1, 1, 1, 2999),
  (2,  1, 2, 2,  999),
  (3,  2, 4, 1, 4999),
  (4,  3, 3, 1, 1599),
  (5,  3, 5, 1,  799),
  (6,  4, 3, 3, 1599),
  (7,  5, 1, 1, 2999),
  (8,  6, 5, 1,  799),
  (9,  6, 6, 1, 1599),
  (10, 6, 2, 1,  999),
  (11, 7, 4, 2, 4999);

INSERT INTO payments (id, order_id, amount_cents, paid_at) VALUES
  (1, 1, 4997, '2026-03-10T09:01:00Z'),
  (2, 2, 4999, '2026-03-15T12:02:00Z'),
  (3, 3, 2398, '2026-03-20T08:31:00Z'),
  (4, 6, 3397, '2026-03-28T10:01:00Z'),
  (5, 7, 5000, '2026-04-02T17:01:00Z'),
  (6, 7, 4998, '2026-04-03T09:00:00Z');
