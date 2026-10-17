// Equivalence partitioning: one case per class of input, valid and invalid.
// Classes and the reasoning behind them: docs/test-strategy/test-plan.md.
import { test, expect } from '@playwright/test';
import { signUp, makeProduct, stockOf, type Account } from './helpers.ts';

let account: Account;
test.beforeAll(async ({ request }) => { account = await signUp(request); });

const product = { name: 'EP Widget', category: 'design' };

test.describe('product price classes', () => {
  const cases: [id: string, label: string, price: unknown, status: number][] = [
    ['TC-EP-01', 'a JSON number',           12.5,    201],
    ['TC-EP-02', 'a numeric string',        '12.5',  400],
    ['TC-EP-03', 'an empty string',         '',      400],
    ['TC-EP-04', 'a boolean',               true,    400],
    ['TC-EP-05', 'a non-numeric string',    'abc',   400],
    ['TC-EP-06', 'a one-number array',      [5],     400],
  ];
  for (const [id, label, price, status] of cases) {
    test(`${id} price as ${label} returns ${status} @regression`, async ({ request }) => {
      const res = await request.post('/products', { headers: account.auth, data: { ...product, price } });
      expect(res.status()).toBe(status);
      const body = await res.json();
      if (status === 201) expect(body.price).toBe(price);
      else expect(body.error).toBe('price must be a non-negative number');
    });
  }
});

test.describe('product stock classes', () => {
  test('TC-EP-07 stock left out defaults to 0 @regression', async ({ request }) => {
    const res = await request.post('/products', { headers: account.auth, data: { ...product, price: 1 } });
    expect(res.status()).toBe(201);
    expect((await res.json()).stock).toBe(0);
  });

  const cases: [id: string, label: string, stock: unknown][] = [
    ['TC-EP-08', 'an empty string',  ''],
    ['TC-EP-09', 'a numeric string', '5'],
    ['TC-EP-10', 'a fraction',       2.5],
  ];
  for (const [id, label, stock] of cases) {
    test(`${id} stock as ${label} returns 400 @regression`, async ({ request }) => {
      const res = await request.post('/products', { headers: account.auth, data: { ...product, price: 1, stock } });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe('stock must be a non-negative whole number');
    });
  }
});

test.describe('order line classes', () => {
  test('TC-EP-11 a whole-number quantity is accepted @regression', async ({ request }) => {
    const p = await makeProduct(request, account);
    const res = await request.post('/orders', { headers: account.auth, data: { items: [{ product_id: p.id, quantity: 2 }] } });
    expect(res.status()).toBe(201);
    expect(await stockOf(request, p.id)).toBe(8);
  });

  const cases: [id: string, label: string, line: (productId: number) => unknown][] = [
    ['TC-EP-12', 'a quantity sent as a string', (id) => ({ product_id: id, quantity: '2' })],
    ['TC-EP-13', 'a fractional quantity',       (id) => ({ product_id: id, quantity: 1.5 })],
    ['TC-EP-14', 'no quantity',                 (id) => ({ product_id: id })],
    ['TC-EP-15', 'a null line',                 ()   => null],
  ];
  for (const [id, label, line] of cases) {
    test(`${id} ${label} returns a JSON 400 and takes no stock @regression`, async ({ request }) => {
      const p = await makeProduct(request, account);
      const res = await request.post('/orders', { headers: account.auth, data: { items: [line(p.id)] } });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toMatch(/whole-number quantity/);
      expect(await stockOf(request, p.id)).toBe(10);
    });
  }

  test('TC-EP-16 items that are not an array return 400 @regression', async ({ request }) => {
    const res = await request.post('/orders', { headers: account.auth, data: { items: 'two widgets' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('items must be a non-empty array');
  });
});

test.describe('request body classes', () => {
  test('TC-EP-17 a malformed JSON body returns a JSON 400 @regression', async ({ request }) => {
    // A Buffer, because Playwright JSON-encodes a string body.
    const res = await request.post('/products', { headers: account.auth, data: Buffer.from('{"name": "Widget",') });
    expect(res.status()).toBe(400);
    expect(res.headers()['content-type']).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: 'Request body is not valid JSON' });
  });

  const auth: [id: string, path: string, label: string, body: Record<string, unknown>][] = [
    ['TC-EP-18', '/auth/register', 'a numeric password', { name: 'N', email: 'ep18@example.com', password: 12345 }],
    ['TC-EP-19', '/auth/register', 'an object email',    { name: 'N', email: { $ne: '' }, password: 'Pass123!' }],
    ['TC-EP-20', '/auth/login',    'a numeric password', { email: 'ep20@example.com', password: 12345 }],
  ];
  for (const [id, path, label, body] of auth) {
    test(`${id} ${path} with ${label} returns 400, not 500 @regression`, async ({ request }) => {
      const res = await request.post(path, { data: body });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toMatch(/required strings/);
    });
  }
});
