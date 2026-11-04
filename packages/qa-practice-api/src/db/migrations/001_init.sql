-- The first schema, as the server created it before migrations existed. Every statement is
-- IF NOT EXISTS, so a database made by that older server takes this migration as a no-op and
-- only gets its version recorded. Down drops the tables, and the data in them.
-- up
CREATE TABLE IF NOT EXISTS users (
  id         serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  name       text NOT NULL,
  email      text NOT NULL UNIQUE,
  password   text NOT NULL,
  role       text NOT NULL CHECK (role IN ('user', 'admin'))
);
CREATE TABLE IF NOT EXISTS products (
  id         serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  name       text NOT NULL,
  category   text NOT NULL,
  price      numeric NOT NULL CHECK (price >= 0),
  stock      numeric NOT NULL CHECK (stock >= 0)
);
CREATE TABLE IF NOT EXISTS orders (
  id            serial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       integer NOT NULL,
  status        text NOT NULL CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  subtotal      numeric NOT NULL,
  discount_code text,
  discount      numeric NOT NULL,
  total         numeric NOT NULL CHECK (total >= 0)
);
CREATE INDEX IF NOT EXISTS orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_discount_code ON orders (discount_code);
CREATE TABLE IF NOT EXISTS order_items (
  order_id   integer NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  position   integer NOT NULL,
  product_id integer NOT NULL,
  name       text NOT NULL,
  price      numeric NOT NULL,
  quantity   numeric NOT NULL CHECK (quantity >= 1),
  PRIMARY KEY (order_id, position)
);
CREATE TABLE IF NOT EXISTS discounts (
  id           serial PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  code         text NOT NULL UNIQUE,
  type         text NOT NULL CHECK (type IN ('percent', 'fixed')),
  value        numeric NOT NULL,
  expires_at   text,
  max_uses     numeric,
  min_subtotal numeric NOT NULL,
  active       boolean NOT NULL
);
-- down
DROP TABLE IF EXISTS discounts;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
