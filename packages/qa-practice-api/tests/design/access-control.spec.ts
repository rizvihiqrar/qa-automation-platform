// Access control: each protected action tried by each kind of caller (a customer
// acting on their own data, a customer acting on someone else's, the admin, and a
// token that should no longer work). The matrix is in docs/test-strategy/test-plan.md.
import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { signUp, admin, makeProduct, stockOf, PASSWORD, type Account } from './helpers.ts';
import { adminId } from '../admin.ts';

const product = { name: 'AC Widget', category: 'design', price: 10, stock: 10 };

async function placeOrder(request: Parameters<typeof makeProduct>[0], account: Account) {
  const p = await makeProduct(request, { stock: 10 });
  const res = await request.post('/orders', { headers: account.auth, data: { items: [{ product_id: p.id, quantity: 1 }] } });
  if (res.status() !== 201) throw new Error(`order setup failed: ${res.status()}`);
  return { orderId: (await res.json()).id as number, productId: p.id };
}

const statusOf = async (request: Parameters<typeof makeProduct>[0], orderId: number) =>
  (await (await request.get(`/orders/${orderId}`, { headers: admin().auth })).json()).status;

const move = (request: Parameters<typeof makeProduct>[0], auth: Account['auth'], orderId: number, status: string) =>
  request.patch(`/orders/${orderId}/status`, { headers: auth, data: { status } });

test.describe('products: only the admin changes the catalogue', () => {
  test('TC-AC-01 a customer creating a product gets 403 @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.post('/products', { headers: me.auth, data: product });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe('Admin role required');
  });

  test('TC-AC-02 a customer repricing a product gets 403 and the price stays @regression', async ({ request }) => {
    const [me, p] = [await signUp(request), await makeProduct(request, { price: 10 })];
    const res = await request.put(`/products/${p.id}`, { headers: me.auth, data: { price: 0.01 } });
    expect(res.status()).toBe(403);
    expect((await (await request.get(`/products/${p.id}`)).json()).price).toBe(10);
  });

  test('TC-AC-03 a customer deleting a product gets 403 and it stays @regression', async ({ request }) => {
    const [me, p] = [await signUp(request), await makeProduct(request)];
    expect((await request.delete(`/products/${p.id}`, { headers: me.auth })).status()).toBe(403);
    expect((await request.get(`/products/${p.id}`)).status()).toBe(200);
  });

  test('TC-AC-04 the admin creates, updates and deletes a product @regression', async ({ request }) => {
    const created = await request.post('/products', { headers: admin().auth, data: product });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    expect((await request.put(`/products/${id}`, { headers: admin().auth, data: { price: 12 } })).status()).toBe(200);
    expect((await request.delete(`/products/${id}`, { headers: admin().auth })).status()).toBe(204);
  });
});

test.describe('orders: a customer reaches only their own', () => {
  test('TC-AC-05 a customer reading another customer\'s order gets 404 @regression', async ({ request }) => {
    const [me, other] = [await signUp(request), await signUp(request)];
    const { orderId } = await placeOrder(request, other);
    const res = await request.get(`/orders/${orderId}`, { headers: me.auth });
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toBe(`Order ${orderId} not found`);
  });

  test('TC-AC-06 a customer\'s order list holds only their own orders @regression', async ({ request }) => {
    const [me, other] = [await signUp(request), await signUp(request)];
    const mine = await placeOrder(request, me);
    await placeOrder(request, other);
    const list = await (await request.get('/orders', { headers: me.auth })).json();
    expect(list.map((o: { id: number }) => o.id)).toEqual([mine.orderId]);
    expect(list.every((o: { user_id: number }) => o.user_id === me.id)).toBe(true);
  });

  test('TC-AC-07 a customer cancelling another customer\'s order gets 404 and it stays pending @regression', async ({ request }) => {
    const [me, other] = [await signUp(request), await signUp(request)];
    const { orderId } = await placeOrder(request, other);
    expect((await move(request, me.auth, orderId, 'cancelled')).status()).toBe(404);
    expect(await statusOf(request, orderId)).toBe('pending');
  });

  test('TC-AC-08 the admin reads any order and sees it in the full list @regression', async ({ request }) => {
    const other = await signUp(request);
    const { orderId } = await placeOrder(request, other);
    expect((await request.get(`/orders/${orderId}`, { headers: admin().auth })).status()).toBe(200);
    const list = await (await request.get('/orders', { headers: admin().auth })).json();
    expect(list.some((o: { id: number }) => o.id === orderId)).toBe(true);
  });
});

test.describe('order status: customers may only cancel', () => {
  test('TC-AC-09 a customer moving their own order to processing gets 403 @regression', async ({ request }) => {
    const me = await signUp(request);
    const { orderId } = await placeOrder(request, me);
    const res = await move(request, me.auth, orderId, 'processing');
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe('Customers can only cancel an order');
    expect(await statusOf(request, orderId)).toBe('pending');
  });

  test('TC-AC-10 a customer marking their own shipped order delivered gets 403 @regression', async ({ request }) => {
    const me = await signUp(request);
    const { orderId } = await placeOrder(request, me);
    for (const step of ['processing', 'shipped']) expect((await move(request, admin().auth, orderId, step)).status()).toBe(200);
    expect((await move(request, me.auth, orderId, 'delivered')).status()).toBe(403);
    expect(await statusOf(request, orderId)).toBe('shipped');
  });

  test('TC-AC-11 a customer cancelling their own pending order gets 200 @regression', async ({ request }) => {
    const me = await signUp(request);
    const { orderId, productId } = await placeOrder(request, me);
    const res = await move(request, me.auth, orderId, 'cancelled');
    expect(res.status()).toBe(200);
    expect(await stockOf(request, productId)).toBe(10);
  });

  test('TC-AC-12 the admin moves a customer\'s order to processing @regression', async ({ request }) => {
    const other = await signUp(request);
    const { orderId } = await placeOrder(request, other);
    expect((await move(request, admin().auth, orderId, 'processing')).status()).toBe(200);
    expect(await statusOf(request, orderId)).toBe('processing');
  });
});

test.describe('accounts: only the admin sees other people\'s', () => {
  test('TC-AC-13 a customer listing all users gets 403 @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.get('/users', { headers: me.auth });
    expect(res.status()).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('@example.com');
  });

  test('TC-AC-14 a customer reading another user\'s account gets 403 @regression', async ({ request }) => {
    const [me, other] = [await signUp(request), await signUp(request)];
    const res = await request.get(`/users/${other.id}`, { headers: me.auth });
    expect(res.status()).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain(other.email);
  });

  test('TC-AC-15 a customer reading their own account gets 200 @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.get(`/users/${me.id}`, { headers: me.auth });
    expect(res.status()).toBe(200);
    expect((await res.json()).email).toBe(me.email);
  });

  test('TC-AC-16 the admin deletes a customer\'s account @regression', async ({ request }) => {
    const other = await signUp(request);
    expect((await request.delete(`/users/${other.id}`, { headers: admin().auth })).status()).toBe(204);
    expect((await request.get(`/users/${other.id}`, { headers: admin().auth })).status()).toBe(404);
  });
});

test.describe('tokens and roles', () => {
  test('TC-AC-17 a deleted account\'s token gets 401 from GET /auth/me @regression', async ({ request }) => {
    const me = await signUp(request);
    expect((await request.delete(`/users/${me.id}`, { headers: me.auth })).status()).toBe(204);
    const res = await request.get('/auth/me', { headers: me.auth });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toBe('Account no longer exists');
  });

  test('TC-AC-18 a deleted account\'s token can\'t place an order, and no stock is taken @regression', async ({ request }) => {
    const [me, p] = [await signUp(request), await makeProduct(request, { stock: 10 })];
    expect((await request.delete(`/users/${me.id}`, { headers: me.auth })).status()).toBe(204);
    const res = await request.post('/orders', { headers: me.auth, data: { items: [{ product_id: p.id, quantity: 3 }] } });
    expect(res.status()).toBe(401);
    expect(await stockOf(request, p.id)).toBe(10);
  });

  test('TC-AC-19 a token signed with the old built-in secret gets 401 @regression', async ({ request }) => {
    // The fallback secret that used to be in src/middleware/auth.ts, readable by anyone.
    const forged = jwt.sign({ id: adminId(), role: 'admin' }, 'qa-practice-secret-change-in-prod', { expiresIn: '1h' });
    const res = await request.get('/users', { headers: { Authorization: `Bearer ${forged}` } });
    expect(res.status()).toBe(401);
  });

  test('TC-AC-20 an unsigned token (alg none) claiming admin gets 401 @regression', async ({ request }) => {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part({ id: adminId(), role: 'admin' })}.`;
    const res = await request.get('/users', { headers: { Authorization: `Bearer ${unsigned}` } });
    expect(res.status()).toBe(401);
  });

  test('TC-AC-21 signing up with role admin creates a customer @regression', async ({ request }) => {
    const email = `ac21.${Date.now()}.${Math.random()}@example.com`;
    const res = await request.post('/auth/register', { data: { name: 'Climber', email, password: PASSWORD, role: 'admin' } });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('user');
    expect((await request.get('/users', { headers: { Authorization: `Bearer ${body.token}` } })).status()).toBe(403);
  });

  test('TC-AC-22 setting role admin on your own account changes nothing @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.put(`/users/${me.id}`, { headers: me.auth, data: { role: 'admin' } });
    expect(res.status()).toBe(200);
    expect((await res.json()).role).toBe('user');
    expect((await request.get('/users', { headers: me.auth })).status()).toBe(403);
  });
});
