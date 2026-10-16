-- Orders database used by the integrity checks.
-- Money is stored in whole cents so totals compare exactly (no floating-point drift).
-- Dates are ISO-8601 text, which sorts and compares correctly as strings.
-- Foreign keys are deliberately not enforced: the checks exist to find the bad
-- rows that slip into real systems through imports, migrations and manual fixes.

CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE products (
  id           INTEGER PRIMARY KEY,
  sku          TEXT NOT NULL,
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL
);

CREATE TABLE orders (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL,
  status       TEXT NOT NULL,          -- pending | processing | shipped | delivered | cancelled
  total_cents  INTEGER NOT NULL,
  ordered_at   TEXT NOT NULL,
  shipped_at   TEXT                     -- only for shipped and delivered orders
);

CREATE TABLE order_items (
  id                INTEGER PRIMARY KEY,
  order_id          INTEGER NOT NULL,
  product_id        INTEGER NOT NULL,
  quantity          INTEGER NOT NULL,
  unit_price_cents  INTEGER NOT NULL
);

CREATE TABLE payments (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL,
  amount_cents  INTEGER NOT NULL,
  paid_at       TEXT NOT NULL
);
