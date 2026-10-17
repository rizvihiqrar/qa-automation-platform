// Decision tables: each rule is one combination of conditions with one expected
// outcome. The full tables, with the rules that can't be reached through the API,
// are in docs/test-strategy/test-plan.md.
import { test, expect } from '@playwright/test';
import { signUp, makeProduct, stockOf } from './helpers.ts';

test.describe('PUT /users/:id', () => {
  test('TC-DT-01 another user\'s account returns 403 @regression', async ({ request }) => {
    const [me, other] = [await signUp(request), await signUp(request)];
    const res = await request.put(`/users/${other.id}`, { headers: me.auth, data: { name: 'Taken over' } });
    expect(res.status()).toBe(403);
  });

  test('TC-DT-02 own account with a free email returns 200 @regression', async ({ request }) => {
    const me = await signUp(request);
    const email = `free.${me.id}.${Date.now()}@example.com`;
    const res = await request.put(`/users/${me.id}`, { headers: me.auth, data: { name: 'Renamed', email } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Renamed', email });
  });

  test('TC-DT-03 own account keeping its own email returns 200 @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.put(`/users/${me.id}`, { headers: me.auth, data: { email: me.email } });
    expect(res.status()).toBe(200);
  });

  test('TC-DT-04 own account taking another user\'s email returns 409 and changes nothing @regression', async ({ request }) => {
    const [me, other] = [await signUp(request), await signUp(request)];
    const res = await request.put(`/users/${me.id}`, { headers: me.auth, data: { name: 'Changed', email: other.email } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe('Email already in use');
    expect(await (await request.get(`/users/${me.id}`, { headers: me.auth })).json()).toMatchObject({ email: me.email, name: 'Design Tester' });
  });

  const invalid: [id: string, label: string, data: Record<string, unknown>, error: string][] = [
    ['TC-DT-05', 'an empty name',   { name: '  ' },  'name must be a non-empty string'],
    ['TC-DT-06', 'a numeric email', { email: 42 },   'email must be a non-empty string'],
  ];
  for (const [id, label, data, error] of invalid) {
    test(`${id} own account with ${label} returns 400 @regression`, async ({ request }) => {
      const me = await signUp(request);
      const res = await request.put(`/users/${me.id}`, { headers: me.auth, data });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe(error);
    });
  }

  test('TC-DT-07 a user that does not exist returns 403, not 404, to a non-admin @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.put('/users/999999', { headers: me.auth, data: { name: 'Ghost' } });
    expect(res.status()).toBe(403);
  });

  test('TC-DT-08 own account after it was deleted returns 404 @regression', async ({ request }) => {
    const me = await signUp(request);
    expect((await request.delete(`/users/${me.id}`, { headers: me.auth })).status()).toBe(204);
    const res = await request.put(`/users/${me.id}`, { headers: me.auth, data: { name: 'Back' } });
    expect(res.status()).toBe(404);
  });
});

test.describe('POST /orders', () => {
  test('TC-DT-09 no token returns 401 @regression', async ({ request }) => {
    const res = await request.post('/orders', { data: { items: [{ product_id: 1, quantity: 1 }] } });
    expect(res.status()).toBe(401);
  });

  test('TC-DT-10 signed in, invalid line returns 400 @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.post('/orders', { headers: me.auth, data: { items: [{ product_id: 1, quantity: 0 }] } });
    expect(res.status()).toBe(400);
  });

  test('TC-DT-11 signed in, valid line, missing product returns 404 @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.post('/orders', { headers: me.auth, data: { items: [{ product_id: 999999, quantity: 1 }] } });
    expect(res.status()).toBe(404);
  });

  test('TC-DT-12 signed in, valid line, product exists, too little stock returns 400 @regression', async ({ request }) => {
    const me = await signUp(request);
    const p = await makeProduct(request, me, { stock: 1 });
    const res = await request.post('/orders', { headers: me.auth, data: { items: [{ product_id: p.id, quantity: 2 }] } });
    expect(res.status()).toBe(400);
  });

  test('TC-DT-13 every condition met returns 201 with the total @regression', async ({ request }) => {
    const me = await signUp(request);
    const p = await makeProduct(request, me, { price: 0.1, stock: 3 });
    const res = await request.post('/orders', { headers: me.auth, data: { items: [{ product_id: p.id, quantity: 3 }] } });
    expect(res.status()).toBe(201);
    // 0.1 * 3 is 0.30000000000000004 in floating point; the total is rounded to cents.
    expect((await res.json()).total).toBe(0.3);
  });

  test('TC-DT-14 one good line and one missing product returns 404 and takes no stock @regression', async ({ request }) => {
    const me = await signUp(request);
    const p = await makeProduct(request, me, { stock: 5 });
    const items = [{ product_id: p.id, quantity: 2 }, { product_id: 999999, quantity: 1 }];
    const res = await request.post('/orders', { headers: me.auth, data: { items } });
    expect(res.status()).toBe(404);
    expect(await stockOf(request, p.id)).toBe(5);
  });
});
