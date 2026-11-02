// The Postgres store, used when DATABASE_URL is set (src/db/store.ts). Same shape
// as the in-memory store (types.ts), so the routes don't know which one they have.
// The schema also guards the data itself: stock can't go below 0, emails and codes
// are unique, so a bug in a route can't store what these rules forbid.
import pg from 'pg';
import { inSpan } from '../telemetry.ts';
import { toId, UniqueViolation } from './types.ts';
import type { Row, Id, Table, Tables, Store, FindOptions, Page, Order, OrderItem } from './types.ts';

// Runs once at start-up; IF NOT EXISTS makes a restart on the same database safe.
// Money is numeric (exact decimals, not floating point). So are stock, quantities and
// max_uses: the API accepts any whole number, and 1e19 or 1e21 don't fit a bigint
// (a 500 where the in-memory store said 201). expires_at is text
// because the API returns it exactly as the admin sent it, offset included.
// No foreign keys from orders to users or products: the API lets an admin delete
// either while old orders keep the id, as the in-memory store always has.
export const SCHEMA = `
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
`;

// numeric and bigint arrive as strings by default (they can hold more than a JS
// number); the API has always used plain numbers, so convert them. Dates go back
// to the ISO strings the in-memory store returns.
const types = {
  getTypeParser(oid: number, format?: string) {
    if (oid === pg.types.builtins.NUMERIC || oid === pg.types.builtins.INT8) return Number;
    if (oid === pg.types.builtins.TIMESTAMPTZ) return (v: string) => new Date(v).toISOString();
    return pg.types.getTypeParser(oid, format as 'text');
  },
};

type Query = (text: string, values?: unknown[]) => Promise<pg.QueryResult>;

// Each statement is a span (src/telemetry.ts) named by its first word (SELECT,
// BEGIN…), with the SQL as sent: the values travel apart from it ($1, $2), so no
// email or password is in the text.
const tracedQuery = (run: Query): Query => (text, values) =>
  inSpan(text.trimStart().split(/\s/, 1)[0]!.toUpperCase(), {
    'db.system.name': 'postgresql', 'db.query.text': text,
  }, () => run(text, values));

// Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
function translate(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505') throw new UniqueViolation(e.constraint?.replace(/^\w+?_(\w+)_key$/, '$1') ?? 'value');
  throw err;
}

// serial ids are 32-bit. A URL id that isn't one can't match a row, and asking
// Postgres would fail with "out of range" (a 500) instead of a 404.
const MAX_ID = 2 ** 31 - 1;
const validId = (id: number) => Number.isInteger(id) && id >= 1 && id <= MAX_ID;

class PgTable<T extends Row> implements Table<T> {
  protected query: Query;
  protected name: string;
  protected columns: string[];

  constructor(query: Query, name: string, columns: string[]) {
    this.query = query;
    this.name = name;
    this.columns = columns;
  }

  protected select(): string {
    return `SELECT * FROM ${this.name} t`;
  }

  // Column names come only from `columns`, never from a request.
  protected where(filter: Partial<T>, values: unknown[]): string {
    const parts = Object.entries(filter).map(([column, value]) => {
      if (column !== 'id' && !this.columns.includes(column)) throw new Error(`${this.name} has no column ${column}`);
      values.push(value);
      return `t.${column} = $${values.length}`;
    });
    return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
  }

  protected lockClause(options?: FindOptions): string {
    return options?.lock ? ' FOR UPDATE OF t' : '';
  }

  async insert(record: Omit<T, keyof Row>): Promise<T> {
    const columns = this.columns.filter((c) => c in record);
    const values = columns.map((c) => (record as Record<string, unknown>)[c]);
    const { rows } = await this.query(
      `INSERT INTO ${this.name} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      values,
    ).catch(translate);
    return (await this.findById(rows[0].id))!;
  }

  async findById(id: Id, options?: FindOptions): Promise<T | null> {
    const n = toId(id);
    if (!validId(n)) return null;
    const { rows } = await this.query(`${this.select()} WHERE t.id = $1${this.lockClause(options)}`, [n]);
    return rows[0] ?? null;
  }

  async findOne(filter: Partial<T>, options?: FindOptions): Promise<T | null> {
    const values: unknown[] = [];
    const { rows } = await this.query(`${this.select()}${this.where(filter, values)} ORDER BY t.id LIMIT 1${this.lockClause(options)}`, values);
    return rows[0] ?? null;
  }

  async findAll(filter: Partial<T> = {}, { page = 1, limit = 10 } = {}): Promise<Page<T>> {
    const values: unknown[] = [];
    const where = this.where(filter, values);
    const { rows: [{ total }] } = await this.query(`SELECT count(*) AS total FROM ${this.name} t${where}`, values);
    const pages = Math.max(1, Math.ceil(total / limit));
    // A page far past the end is empty, as in memory; its offset may not even fit
    // a bigint (page=1e18), which Postgres would refuse with a 500.
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset) || offset >= total) return { data: [], total, pages };
    const { rows } = await this.query(
      `${this.select()}${where} ORDER BY t.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    return { data: rows, total, pages };
  }

  // Undefined values in `changes` leave the field as it was; null clears it.
  async update(id: Id, changes: Partial<Omit<T, keyof Row>>): Promise<T | null> {
    const n = toId(id);
    if (!validId(n)) return null;
    const set = Object.entries(changes).filter(([c, v]) => v !== undefined && this.columns.includes(c));
    if (set.length) {
      const { rowCount } = await this.query(
        `UPDATE ${this.name} SET ${set.map(([c], i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [n, ...set.map(([, v]) => v)],
      ).catch(translate);
      if (!rowCount) return null;
    }
    return this.findById(n);
  }

  async delete(id: Id): Promise<boolean> {
    const n = toId(id);
    if (!validId(n)) return false;
    const { rowCount } = await this.query(`DELETE FROM ${this.name} WHERE id = $1`, [n]);
    return (rowCount ?? 0) > 0;
  }
}

// An order's lines live in order_items, read back in the order they were sent.
class OrdersTable extends PgTable<Order> {
  protected override select(): string {
    return `SELECT t.*, COALESCE((
      SELECT json_agg(json_build_object('product_id', i.product_id, 'name', i.name, 'price', i.price, 'quantity', i.quantity) ORDER BY i.position)
      FROM order_items i WHERE i.order_id = t.id), '[]') AS items
    FROM orders t`;
  }

  // Called inside the order's transaction, so the order and its lines are saved together.
  override async insert(record: Omit<Order, keyof Row>): Promise<Order> {
    const { items, ...order } = record;
    const columns = this.columns.filter((c) => c in order);
    const { rows } = await this.query(
      `INSERT INTO orders (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      columns.map((c) => (order as Record<string, unknown>)[c]),
    ).catch(translate);
    const id = rows[0].id;
    for (const [position, item] of items.entries()) {
      const { product_id, name, price, quantity }: OrderItem = item;
      await this.query(
        'INSERT INTO order_items (order_id, position, product_id, name, price, quantity) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, position, product_id, name, price, quantity],
      ).catch(translate);
    }
    return (await this.findById(id))!;
  }
}

function tables(query: Query): Tables {
  return {
    users:     new PgTable(query, 'users', ['name', 'email', 'password', 'role']),
    products:  new PgTable(query, 'products', ['name', 'category', 'price', 'stock']),
    orders:    new OrdersTable(query, 'orders', ['user_id', 'status', 'subtotal', 'discount_code', 'discount', 'total']),
    discounts: new PgTable(query, 'discounts', ['code', 'type', 'value', 'expires_at', 'max_uses', 'min_subtotal', 'active']),
  };
}

export async function openPostgres(connectionString: string): Promise<Store> {
  // Transactions waiting on a locked row each hold a connection, so leave room for
  // the requests that are not in one.
  const pool = new pg.Pool({ connectionString, max: 20, types });
  pool.on('error', (err) => console.error(`postgres pool error: ${err.message}`));

  // One server at a time sets up the schema (two starting together could both try
  // to create a table).
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(49)');
    await client.query(SCHEMA);
  } finally {
    await client.query('SELECT pg_advisory_unlock(49)');
    client.release();
  }

  const query = tracedQuery((text, values) => pool.query(text, values));
  return {
    ...tables(query),
    // All of `work` on one connection between BEGIN and COMMIT; any error rolls
    // every write back. Row locks taken with { lock: true } last until the end.
    async transaction(work) {
      const conn = await pool.connect();
      const run = tracedQuery((text, values) => conn.query(text, values));
      // A connection whose ROLLBACK failed may still be inside the aborted
      // transaction; it is closed instead of going back to the pool.
      let broken: Error | undefined;
      try {
        await run('BEGIN');
        const result = await work(tables(run));
        await run('COMMIT');
        return result;
      } catch (err) {
        await run('ROLLBACK').catch((e: Error) => { broken = e; });
        throw err;
      } finally {
        conn.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
