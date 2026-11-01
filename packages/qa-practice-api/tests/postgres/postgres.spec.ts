import { spawn } from 'node:child_process';
import { test, expect } from '@playwright/test';
import pg from 'pg';
import { openPostgres } from '../../src/db/postgres.ts';
import { makeProduct, signUp, admin } from '../design/helpers.ts';
import { ADMIN } from '../admin.ts';

// Only on Postgres (npm run test:postgres; playwright.config.ts skips this folder
// without DATABASE_URL). These check what the in-memory store can't show: the data
// is really in the database, the schema's own rules hold, it outlives the server,
// and transactions and row locks behave as the routes rely on.

const DATABASE_URL = process.env.DATABASE_URL!;

async function sql<T = any>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

// Postgres error code of a failed statement (23505 unique, 23514 check).
async function errorCode(text: string, values: unknown[] = []): Promise<string | undefined> {
  try {
    await sql(text, values);
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

const unique = () => `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe('Postgres store', () => {
  test('PG-01 an order placed through the API is a row in orders, with its lines in order_items in the order sent @regression', async ({ request }) => {
    const [a, b] = await Promise.all([makeProduct(request, { price: 2.5 }), makeProduct(request, { price: 4 })]);
    const buyer = await signUp(request);
    const res = await request.post('/orders', { headers: buyer.auth, data: { items: [{ product_id: b.id, quantity: 2 }, { product_id: a.id, quantity: 1 }] } });
    expect(res.status()).toBe(201);
    const { id } = await res.json();
    const [order] = await sql('SELECT user_id, status, total::text FROM orders WHERE id = $1', [id]);
    expect(order).toEqual({ user_id: buyer.id, status: 'pending', total: '10.5' });
    const lines = await sql('SELECT product_id, quantity::int FROM order_items WHERE order_id = $1 ORDER BY position', [id]);
    expect(lines).toEqual([{ product_id: b.id, quantity: 2 }, { product_id: a.id, quantity: 1 }]);
  });

  test('PG-02 the database itself refuses stock below 0, whatever the app sends @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 1 });
    expect(await errorCode('UPDATE products SET stock = -1 WHERE id = $1', [product.id])).toBe('23514');
    const [row] = await sql('SELECT stock::int FROM products WHERE id = $1', [product.id]);
    expect(row.stock).toBe(1);
  });

  test('PG-03 the database itself refuses a second account with the same email @regression', async ({ request }) => {
    const user = await signUp(request);
    expect(await errorCode(
      "INSERT INTO users (name, email, password, role) VALUES ('Copy', $1, 'x', 'user')", [user.email],
    )).toBe('23505');
  });

  test('PG-04 a second server on the same database sees the same data, and its schema set-up runs again safely @regression', async ({ request }, testInfo) => {
    test.setTimeout(30000);
    const name = `Outlives ${unique()}`;
    const product = await makeProduct(request, { name });
    const port = 4500 + testInfo.workerIndex;
    const server = spawn(process.execPath, ['src/server.ts'], {
      env: { ...process.env, PORT: String(port), DATABASE_URL, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password },
      stdio: 'ignore',
    });
    try {
      const other = `http://localhost:${port}`;
      await expect.poll(async () => (await fetch(`${other}/health`).catch(() => null))?.status, { timeout: 15000 }).toBe(200);
      const seen = await (await fetch(`${other}/products/${product.id}`)).json();
      expect(seen.name).toBe(name);
      // The admin seed found the existing account instead of making a second one.
      const [{ admins }] = await sql("SELECT count(*)::int AS admins FROM users WHERE role = 'admin'");
      expect(admins).toBe(1);
    } finally {
      server.kill();
    }
  });

  test('PG-05 a transaction that fails halfway leaves nothing behind @regression', async () => {
    const store = await openPostgres(DATABASE_URL);
    const name = `Rolled back ${unique()}`;
    try {
      await expect(store.transaction(async (tx) => {
        await tx.products.insert({ name, category: 'pg', price: 1, stock: 1 });
        throw new Error('fail after the first write');
      })).rejects.toThrow('fail after the first write');
      expect(await store.products.findOne({ name })).toBeNull();
    } finally {
      await store.close();
    }
  });

  test('PG-06 a row locked in one transaction makes a second one wait until the first ends @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 5 });
    const store = await openPostgres(DATABASE_URL);
    try {
      const events: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const first = store.transaction(async (tx) => {
        await tx.products.findById(product.id, { lock: true });
        locked();
        await held;
        await tx.products.update(product.id, { stock: 4 });
        events.push('first done');
      });
      await isLocked;
      const second = store.transaction(async (tx) => {
        const row = await tx.products.findById(product.id, { lock: true });
        events.push(`second read ${row!.stock}`);
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(events, 'the second transaction is still waiting').toEqual([]);
      release();
      await Promise.all([first, second]);
      expect(events).toEqual(['first done', 'second read 4']);
    } finally {
      await store.close();
    }
  });

  test('PG-07 money and large whole numbers come back exactly as sent: numeric, not floating point or bigint @regression', async ({ request }) => {
    for (const price of [0.29, 19.99, 1234567.89, 999999999.99]) {
      const product = await makeProduct(request, { price });
      expect((await (await request.get(`/products/${product.id}`)).json()).price).toBe(price);
      const [row] = await sql('SELECT price::text FROM products WHERE id = $1', [product.id]);
      expect(Number(row.price)).toBe(price);
    }
    // Past a bigint (2^63) and past where JavaScript writes 1e+21: the in-memory store
    // accepts both, and a bigint column made them a 500 (code review, Day 49).
    for (const stock of [1e19, 1e21]) {
      const product = await makeProduct(request, { stock });
      expect((await (await request.get(`/products/${product.id}`)).json()).stock).toBe(stock);
    }
  });

  test('PG-08 an id too big for the id column is a 404 and a page far past the end is empty, not a database error @regression', async ({ request }) => {
    const buyer = await signUp(request);
    expect((await request.get('/products/99999999999')).status()).toBe(404);
    expect((await request.get('/orders/99999999999', { headers: buyer.auth })).status()).toBe(404);
    expect((await request.get('/users/99999999999', { headers: admin().auth })).status()).toBe(404);
    expect((await request.put('/products/99999999999', { headers: admin().auth, data: { stock: 1 } })).status()).toBe(404);
    // Its offset doesn't fit a bigint (1e18 pages of 10).
    const far = await request.get('/products?page=1000000000000000000');
    expect(far.status()).toBe(200);
    expect((await far.json()).data).toEqual([]);
  });
});
