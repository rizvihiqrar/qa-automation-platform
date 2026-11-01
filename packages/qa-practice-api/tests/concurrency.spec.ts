import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { signUp, makeProduct, stockOf, admin, type Account } from './design/helpers.ts';

// Many requests at the same moment. Once the store answers over a database
// connection, each request waits between reading and writing, and another can read
// the same row in that gap: two orders both see the last item in stock, two sign-ups
// both see the email free. The routes lock rows in a transaction (src/routes/
// orders.ts, discounts.ts) and the store refuses duplicates (unique email and code).
// On the in-memory store only the sign-up race can happen (password hashing runs
// off the main thread); each order runs start to finish before the next request is
// read, so the order, code and cancel tests here can't fail on it even with the
// locks removed. They are meant for a database store, where they can.

const statuses = (responses: APIResponse[]) => responses.map((r) => r.status()).sort();
const count = (list: number[], status: number) => list.filter((s) => s === status).length;

async function customers(request: APIRequestContext, n: number): Promise<Account[]> {
  return Promise.all(Array.from({ length: n }, () => signUp(request)));
}

const order = (request: APIRequestContext, who: Account, items: unknown[], discount_code?: string) =>
  request.post('/orders', { headers: who.auth, data: { items, ...(discount_code ? { discount_code } : {}) } });

async function makeCode(request: APIRequestContext, fields: Record<string, unknown>): Promise<string> {
  const code = `RACE-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.slice(0, 20).toUpperCase();
  const res = await request.post('/discounts', { headers: admin().auth, data: { code, type: 'percent', value: 10, ...fields } });
  expect(res.status(), await res.text()).toBe(201);
  return code;
}

test.describe('Concurrent requests', () => {
  test('ten orders for the last item: exactly one succeeds @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 1 });
    const buyers = await customers(request, 10);
    const results = statuses(await Promise.all(buyers.map((b) => order(request, b, [{ product_id: product.id, quantity: 1 }]))));
    expect(count(results, 201), `statuses: ${results}`).toBe(1);
    expect(count(results, 400), `statuses: ${results}`).toBe(9);
    expect(await stockOf(request, product.id)).toBe(0);
  });

  test('fifteen orders for five in stock: exactly five succeed and stock ends at 0 @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 5 });
    const buyers = await customers(request, 15);
    const results = statuses(await Promise.all(buyers.map((b) => order(request, b, [{ product_id: product.id, quantity: 1 }]))));
    expect(count(results, 201), `statuses: ${results}`).toBe(5);
    expect(await stockOf(request, product.id)).toBe(0);
  });

  test('orders taking two products in opposite orders all finish without a server error @regression', async ({ request }) => {
    const [a, b] = await Promise.all([makeProduct(request, { stock: 100 }), makeProduct(request, { stock: 100 })]);
    const buyers = await customers(request, 12);
    const results = statuses(await Promise.all(buyers.map((who, i) => order(request, who, i % 2
      ? [{ product_id: a.id, quantity: 1 }, { product_id: b.id, quantity: 1 }]
      : [{ product_id: b.id, quantity: 1 }, { product_id: a.id, quantity: 1 }]))));
    expect(results, 'no deadlock or other 500').toEqual(Array(12).fill(201));
    expect(await stockOf(request, a.id)).toBe(88);
    expect(await stockOf(request, b.id)).toBe(88);
  });

  test('a code with one use left, tried by eight customers at once, is used once @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 50 });
    const code = await makeCode(request, { max_uses: 1 });
    const buyers = await customers(request, 8);
    const results = statuses(await Promise.all(buyers.map((b) => order(request, b, [{ product_id: product.id, quantity: 1 }], code))));
    expect(count(results, 201), `statuses: ${results}`).toBe(1);
    expect(count(results, 422), `statuses: ${results}`).toBe(7);
    const discount = await (await request.get(`/discounts/${code}`, { headers: admin().auth })).json();
    expect(discount.uses).toBe(1);
  });

  test('one customer sending the same code five times at once gets it once @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 50 });
    const code = await makeCode(request, {});
    const [buyer] = await customers(request, 1);
    const results = statuses(await Promise.all(Array.from({ length: 5 }, () => order(request, buyer!, [{ product_id: product.id, quantity: 1 }], code))));
    expect(count(results, 201), `statuses: ${results}`).toBe(1);
    expect(count(results, 422), `statuses: ${results}`).toBe(4);
  });

  test('three cancels of one order at once return its stock once @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 10 });
    const [buyer] = await customers(request, 1);
    const placed = await order(request, buyer!, [{ product_id: product.id, quantity: 3 }]);
    expect(placed.status()).toBe(201);
    const { id } = await placed.json();
    const cancel = () => request.patch(`/orders/${id}/status`, { headers: buyer!.auth, data: { status: 'cancelled' } });
    const results = statuses(await Promise.all([cancel(), cancel(), cancel()]));
    expect(results).toEqual([200, 409, 409]);
    expect(await stockOf(request, product.id)).toBe(10);
  });

  test('eight sign-ups with one email at once: one account, the rest 409 @regression', async ({ request }) => {
    const email = `race.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
    const results = statuses(await Promise.all(Array.from({ length: 8 }, () =>
      request.post('/auth/register', { data: { name: 'Racer', email, password: 'Pass123!' } }))));
    expect(results).toEqual([201, ...Array(7).fill(409)]);
  });

  test('five creates of one discount code at once: one code, the rest 409 @regression', async ({ request }) => {
    const code = `DUP-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.slice(0, 20).toUpperCase();
    const results = statuses(await Promise.all(Array.from({ length: 5 }, () =>
      request.post('/discounts', { headers: admin().auth, data: { code, type: 'fixed', value: 5 } }))));
    expect(results).toEqual([201, 409, 409, 409, 409]);
  });
});
