// Boundary value analysis: the value on each edge of a valid range and one step
// either side. Ranges and step sizes: docs/test-strategy/test-plan.md.
import { test, expect } from '@playwright/test';
import { signUp, makeProduct, stockOf, uniqueCategory, type Account } from './helpers.ts';

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
      const res = await request.post('/products', { headers: account.auth, data: { ...product, price } });
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
      const res = await request.post('/products', { headers: account.auth, data: { ...product, price: 1, stock } });
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
      const p = await makeProduct(request, account, { stock: 5 });
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
    const owner = await signUp(request);
    for (let i = 0; i < 3; i++) await makeProduct(request, owner, { category });
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
