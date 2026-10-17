import { test, expect } from '@playwright/test';
import { adminAuth } from './admin.ts';

test.describe.configure({ mode: 'serial' });

const ts       = Date.now();
const testUser = { name: 'Orders Tester', email: `orders.${ts}@example.com`, password: 'Pass123!' };

let token: string;
let productId: number;
let orderId: number;

test.describe('Orders routes', () => {
  test.beforeAll(async ({ request }) => {
    const authRes = await request.post('/auth/register', { data: testUser });
    token = (await authRes.json()).token;

    const prodRes = await request.post('/products', {
      headers: adminAuth(),
      data: { name: 'Orderable Widget', category: 'test', price: 19.99, stock: 50 },
    });
    productId = (await prodRes.json()).id;
  });

  test('GET /orders requires auth @regression', async ({ request }) => {
    const res = await request.get('/orders');
    expect(res.status()).toBe(401);
  });

  test('GET /orders returns empty list for new user @smoke', async ({ request }) => {
    const res  = await request.get('/orders', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test('POST /orders creates order and decrements product stock @smoke', async ({ request }) => {
    const res  = await request.post('/orders', {
      headers: { Authorization: `Bearer ${token}` },
      data: { items: [{ product_id: productId, quantity: 2 }] },
    });
    const body = await res.json();

    expect(res.status()).toBe(201);
    expect(body.total).toBe(39.98);
    expect(body.status).toBe('pending');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].quantity).toBe(2);
    orderId = body.id;

    const prodRes  = await request.get(`/products/${productId}`);
    const prodBody = await prodRes.json();
    expect(prodBody.stock).toBe(48);
  });

  test('POST /orders with insufficient stock returns 400 @regression', async ({ request }) => {
    const res  = await request.post('/orders', {
      headers: { Authorization: `Bearer ${token}` },
      data: { items: [{ product_id: productId, quantity: 9999 }] },
    });
    const body = await res.json();

    expect(res.status()).toBe(400);
    expect(body.error).toMatch(/insufficient stock/i);
  });

  // Stock used to be checked line by line, so two lines for the same product could
  // each pass and together sell more than was in stock.
  test('POST /orders checks stock against the total across lines for the same product @regression', async ({ request }) => {
    const headers = { Authorization: `Bearer ${token}` };
    const created = await request.post('/products', { headers: adminAuth(), data: { name: 'Scarce Widget', category: 'test', price: 5, stock: 10 } });
    const scarceId: number = (await created.json()).id;

    const res = await request.post('/orders', {
      headers,
      data: { items: [{ product_id: scarceId, quantity: 6 }, { product_id: scarceId, quantity: 6 }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/insufficient stock.*available: 10/i);
    expect((await (await request.get(`/products/${scarceId}`)).json()).stock).toBe(10);

    const ok = await request.post('/orders', {
      headers,
      data: { items: [{ product_id: scarceId, quantity: 4 }, { product_id: scarceId, quantity: 6 }] },
    });
    expect(ok.status()).toBe(201);
    expect((await (await request.get(`/products/${scarceId}`)).json()).stock).toBe(0);
  });

  test('POST /orders with empty items array returns 400 @regression', async ({ request }) => {
    const res = await request.post('/orders', {
      headers: { Authorization: `Bearer ${token}` },
      data: { items: [] },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /orders/:id returns the order with parsed items @regression', async ({ request }) => {
    const res  = await request.get(`/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.id).toBe(orderId);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items[0].name).toBe('Orderable Widget');
  });

  // Moving an order on is the shop's job (customers may only cancel).
  test('PATCH /orders/:id/status updates status @regression', async ({ request }) => {
    const res  = await request.patch(`/orders/${orderId}/status`, {
      headers: adminAuth(),
      data: { status: 'processing' },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.status).toBe('processing');
  });

  test('PATCH /orders/:id/status invalid status returns 400 @regression', async ({ request }) => {
    const res  = await request.patch(`/orders/${orderId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'flying' },
    });
    const body = await res.json();

    expect(res.status()).toBe(400);
    expect(body.error).toMatch(/must be one of/i);
  });
});
