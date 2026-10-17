// Boundary value analysis: the value on each edge of a valid range and one step
// either side. Ranges and step sizes: docs/test-strategy/test-plan.md.
import { test, expect } from '@playwright/test';
import { signUp, signIn, admin, makeProduct, stockOf, uniqueCategory, type Account } from './helpers.ts';

let account: Account;
test.beforeAll(async ({ request }) => { account = await signUp(request); });

const product = { name: 'BVA Widget', category: 'design' };

test.describe('price >= 0 (step 0.01)', () => {
  const cases: [id: string, price: number, status: number][] = [
    ['TC-BVA-01', -0.01, 400],
    ['TC-BVA-02', 0,     201],
    ['TC-BVA-03', 0.01,  201],
  ];
  for (const [id, price, status] of cases) {
    test(`${id} price ${price} returns ${status} @regression`, async ({ request }) => {
      const res = await request.post('/products', { headers: admin().auth, data: { ...product, price } });
      expect(res.status()).toBe(status);
    });
  }
});

test.describe('stock >= 0 (step 1)', () => {
  const cases: [id: string, stock: number, status: number][] = [
    ['TC-BVA-04', -1, 400],
    ['TC-BVA-05', 0,  201],
    ['TC-BVA-06', 1,  201],
  ];
  for (const [id, stock, status] of cases) {
    test(`${id} stock ${stock} returns ${status} @regression`, async ({ request }) => {
      const res = await request.post('/products', { headers: admin().auth, data: { ...product, price: 1, stock } });
      expect(res.status()).toBe(status);
    });
  }
});

test.describe('1 <= quantity <= stock (stock 5)', () => {
  const cases: [id: string, quantities: number[], status: number, stockAfter: number][] = [
    ['TC-BVA-07', [0],    400, 5],
    ['TC-BVA-08', [1],    201, 4],
    ['TC-BVA-09', [5],    201, 0],
    ['TC-BVA-10', [6],    400, 5],
    ['TC-BVA-11', [2, 3], 201, 0],
    ['TC-BVA-12', [3, 3], 400, 5],
  ];
  for (const [id, quantities, status, stockAfter] of cases) {
    const lines = quantities.length > 1 ? `lines of ${quantities.join(' + ')}` : `quantity ${quantities[0]}`;
    test(`${id} ${lines} returns ${status}, leaving stock ${stockAfter} @regression`, async ({ request }) => {
      const p = await makeProduct(request, { stock: 5 });
      const items = quantities.map((quantity) => ({ product_id: p.id, quantity }));
      const res = await request.post('/orders', { headers: account.auth, data: { items } });
      expect(res.status()).toBe(status);
      expect(await stockOf(request, p.id)).toBe(stockAfter);
    });
  }
});

test.describe('1 <= limit <= 50, default 10', () => {
  const cases: [id: string, query: string, limit: number][] = [
    ['TC-BVA-13', '?limit=-1',  1],
    ['TC-BVA-14', '?limit=0',   1],
    ['TC-BVA-15', '?limit=1',   1],
    ['TC-BVA-16', '?limit=50',  50],
    ['TC-BVA-17', '?limit=51',  50],
    ['TC-BVA-18', '',           10],
    ['TC-BVA-19', '?limit=abc', 10],
  ];
  for (const [id, query, limit] of cases) {
    test(`${id} GET /products${query || ' (no limit)'} uses limit ${limit} @regression`, async ({ request }) => {
      const body = await (await request.get(`/products${query}`)).json();
      expect(body.limit).toBe(limit);
      expect(body.data.length).toBeLessThanOrEqual(limit);
    });
  }
});

test.describe('1 <= page <= pages (3 products, limit 2)', () => {
  const category = uniqueCategory();
  test.beforeAll(async ({ request }) => {
    for (let i = 0; i < 3; i++) await makeProduct(request, { category });
  });

  const cases: [id: string, page: number, servedPage: number, items: number][] = [
    ['TC-BVA-20', 0, 1, 2],
    ['TC-BVA-21', 2, 2, 1],
    ['TC-BVA-22', 3, 3, 0],
  ];
  for (const [id, page, servedPage, items] of cases) {
    test(`${id} page ${page} serves page ${servedPage} with ${items} item(s) @regression`, async ({ request }) => {
      const body = await (await request.get(`/products?category=${category}&limit=2&page=${page}`)).json();
      expect(body).toMatchObject({ page: servedPage, total: 3, pages: 2 });
      expect(body.data).toHaveLength(items);
    });
  }
});

// Sign-in attempts without a success, per email and client: 5 allowed, the 6th refused.
test.describe('sign-in attempts <= 5', () => {
  test('TC-BVA-23 the 5th wrong password still returns 401 @regression', async ({ request }) => {
    const me = await signUp(request);
    for (let i = 1; i <= 4; i++) await signIn(request, me.email, 'wrong-password');
    expect((await signIn(request, me.email, 'wrong-password')).status()).toBe(401);
  });

  test('TC-BVA-24 the 6th attempt returns 429 @regression', async ({ request }) => {
    const me = await signUp(request);
    for (let i = 1; i <= 5; i++) await signIn(request, me.email, 'wrong-password');
    expect((await signIn(request, me.email, 'wrong-password')).status()).toBe(429);
  });

  // The same edge under concurrency. Checking a password takes tens of
  // milliseconds, so a limit that counts only finished failures lets a burst of
  // guesses all start before the first one is counted.
  test('TC-BVA-25 20 wrong passwords at once: exactly 5 return 401, 15 return 429 @regression', async ({ request }) => {
    const me = await signUp(request);
    const statuses = await Promise.all(Array.from({ length: 20 }, () => signIn(request, me.email, 'wrong-password').then((r) => r.status())));
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });
});
