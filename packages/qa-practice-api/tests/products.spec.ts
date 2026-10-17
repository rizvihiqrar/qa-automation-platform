import { test, expect } from '@playwright/test';
import { adminToken } from './admin.ts';

test.describe.configure({ mode: 'serial' });

// Changing products is for admins, so these tests sign in as the seeded admin.
// What a customer may not do is in tests/design/access-control.spec.ts.
let token: string;
let productId: number;

test.describe('Products routes', () => {
  test.beforeAll(() => { token = adminToken(); });

  test('GET /products is public and returns paginated list @smoke', async ({ request }) => {
    const res  = await request.get('/products');
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.pages).toBe('number');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('limit');
  });

  test('POST /products without auth returns 401 @regression', async ({ request }) => {
    const res = await request.post('/products', {
      data: { name: 'Unauth Item', category: 'test', price: 9.99 },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /products creates product when signed in as admin @smoke', async ({ request }) => {
    const res  = await request.post('/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Widget', category: 'hardware', price: 29.99, stock: 100 },
    });
    const body = await res.json();

    expect(res.status()).toBe(201);
    expect(body.name).toBe('Test Widget');
    expect(body.price).toBe(29.99);
    expect(body.stock).toBe(100);
    productId = body.id;
  });

  test('POST /products with negative price returns 400 @regression', async ({ request }) => {
    const res = await request.post('/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Bad Price', category: 'test', price: -5 },
    });
    expect(res.status()).toBe(400);
  });

  // Both found by api-drift-checker: the API used to answer 201 for these.
  test('POST /products with a non-numeric price returns 400 @regression', async ({ request }) => {
    const res = await request.post('/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Text Price', category: 'test', price: 'abc' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('price must be a non-negative number');
  });

  test('POST /products with negative stock returns 400 @regression', async ({ request }) => {
    const res = await request.post('/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Negative Stock', category: 'test', price: 5, stock: -3 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('stock must be a non-negative whole number');
  });

  test('POST /products missing required fields returns 400 @regression', async ({ request }) => {
    const res = await request.post('/products', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'No Price' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /products/:id returns specific product @smoke', async ({ request }) => {
    const res  = await request.get(`/products/${productId}`);
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.id).toBe(productId);
    expect(body.name).toBe('Test Widget');
  });

  test('GET /products/:id non-existent ID returns 404 @regression', async ({ request }) => {
    const res  = await request.get('/products/999999');
    const body = await res.json();

    expect(res.status()).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  test('GET /products?category= filters results @regression', async ({ request }) => {
    const res  = await request.get('/products?category=hardware');
    const body = await res.json();

    expect(res.status()).toBe(200);
    body.data.forEach((p: { category: string }) => expect(p.category).toBe('hardware'));
  });

  test('PUT /products/:id updates a field without changing others @regression', async ({ request }) => {
    const res  = await request.put(`/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { price: 34.99 },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.price).toBe(34.99);
    expect(body.name).toBe('Test Widget');
    expect(body.stock).toBe(100);
  });

  // Update used to skip the create rules: price "abc" was stored as null and negative stock was accepted.
  test('PUT /products/:id applies the same price and stock rules as POST @regression', async ({ request }) => {
    const headers = { Authorization: `Bearer ${token}` };
    const badPrice = await request.put(`/products/${productId}`, { headers, data: { price: 'abc' } });
    expect(badPrice.status()).toBe(400);
    expect((await badPrice.json()).error).toBe('price must be a non-negative number');

    const badStock = await request.put(`/products/${productId}`, { headers, data: { stock: -7 } });
    expect(badStock.status()).toBe(400);
    expect((await badStock.json()).error).toBe('stock must be a non-negative whole number');

    const unchanged = await (await request.get(`/products/${productId}`)).json();
    expect(unchanged.price).toBe(34.99);
    expect(unchanged.stock).toBe(100);
  });

  test('DELETE /products/:id removes product @regression', async ({ request }) => {
    const del = await request.delete(`/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status()).toBe(204);

    const get = await request.get(`/products/${productId}`);
    expect(get.status()).toBe(404);
  });
});
