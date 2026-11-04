import { test, expect } from '@playwright/test';
import { signUp, signIn, makeProduct, admin, unusedEmail, PASSWORD } from '../design/helpers.ts';
import { makeCode, getCode, patchCode } from '../discounts/helpers.ts';

// OWASP Top 10 (2021), A08 Software and Data Integrity Failures, as mass assignment: a client
// sends fields it has no right to set (a role, a total, a status, someone else's id) hoping the
// server copies the whole body into the record. In every case below the server must use its
// own value, or refuse the field, and the stored record must show it.

// An id no record gets by chance (a fresh server hands out 1, 2, 3...), so it proves the sent one was ignored.
const FAKE_ID = 987654;

test.describe('A08 fields a client may not set', () => {
  test('OW-A08-01 sign-up ignores a role, an id and a creation time in the body: the account is a customer with a new id @regression', async ({ request }) => {
    const res = await request.post('/auth/register', {
      data: { name: 'Mass', email: unusedEmail(), password: PASSWORD, role: 'admin', id: FAKE_ID, created_at: '2001-01-01T00:00:00Z', isAdmin: true },
    });
    expect(res.status()).toBe(201);
    const { user, token } = await res.json();
    expect(user.role).toBe('user');
    expect(user.id).not.toBe(FAKE_ID);
    expect(user.created_at).not.toBe('2001-01-01T00:00:00Z');
    expect((await request.get('/users', { headers: { Authorization: `Bearer ${token}` } })).status(), 'not an admin').toBe(403);
  });

  test('OW-A08-02 an account update that names a role does not change it: the stored role is still user, and the admin routes stay shut @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.put(`/users/${me.id}`, { headers: me.auth, data: { name: 'Renamed', role: 'admin' } });
    expect(res.status()).toBe(200);
    expect((await res.json()).role).toBe('user');
    expect((await (await request.get(`/users/${me.id}`, { headers: me.auth })).json()).role).toBe('user');
    expect((await request.get('/users', { headers: me.auth })).status()).toBe(403);
  });

  test('OW-A08-03 an account update that names a password or an id changes neither: the old password still signs in, the id is the same @regression', async ({ request }) => {
    const me = await signUp(request);
    const res = await request.put(`/users/${me.id}`, { headers: me.auth, data: { name: 'Same', password: 'Replaced-1!', id: FAKE_ID } });
    expect(res.status()).toBe(200);
    expect((await res.json()).id).toBe(me.id);
    expect((await signIn(request, me.email, PASSWORD)).status(), 'the old password').toBe(200);
    expect((await signIn(request, me.email, 'Replaced-1!')).status(), 'the new one').toBe(401);
  });

  test('OW-A08-04 an order that names a total, a status, an owner or a line price gets its total from the catalogue, starts pending and belongs to the sender @regression', async ({ request }) => {
    const buyer = await signUp(request);
    const other = await signUp(request);
    const product = await makeProduct(request, { name: 'Real catalogue name', price: 10, stock: 5 });
    const res = await request.post('/orders', {
      headers: buyer.auth,
      data: {
        items: [{ product_id: product.id, quantity: 2, price: 0.01, name: 'Free' }],
        total: 0.01, subtotal: 0.01, discount: 99, status: 'delivered', user_id: other.id, id: FAKE_ID,
      },
    });
    expect(res.status()).toBe(201);
    const order = await res.json();
    expect(order.total).toBe(20);
    expect(order.subtotal).toBe(20);
    expect(order.discount).toBe(0);
    expect(order.status).toBe('pending');
    expect(order.user_id).toBe(buyer.id);
    expect(order.id).not.toBe(FAKE_ID);
    expect(order.items[0].price).toBe(10);
    expect(order.items[0].name).toBe('Real catalogue name');
  });

  test('OW-A08-05 a status change cannot also carry a total or an owner, and the stored order shows only the status moved @regression', async ({ request }) => {
    const buyer = await signUp(request);
    const product = await makeProduct(request, { price: 10, stock: 5 });
    const order = await (await request.post('/orders', { headers: buyer.auth, data: { items: [{ product_id: product.id, quantity: 1 }] } })).json();
    const res = await request.patch(`/orders/${order.id}/status`, { headers: buyer.auth, data: { status: 'cancelled', total: 0, user_id: 1 } });
    expect(res.status()).toBe(200);
    const after = await (await request.get(`/orders/${order.id}`, { headers: buyer.auth })).json();
    expect(after.status).toBe('cancelled');
    expect(after.total).toBe(10);
    expect(after.user_id).toBe(buyer.id);
  });

  test('OW-A08-06 a product update that names an id or a creation time keeps both @regression', async ({ request }) => {
    const product = await makeProduct(request);
    const before = await (await request.get(`/products/${product.id}`)).json();
    const res = await request.put(`/products/${product.id}`, { headers: admin().auth, data: { price: 12, id: FAKE_ID, created_at: '2001-01-01T00:00:00Z' } });
    expect(res.status()).toBe(200);
    const after = await res.json();
    expect(after.id).toBe(product.id);
    expect(after.created_at).toBe(before.created_at);
    expect(after.price).toBe(12);
  });

  test('OW-A08-07 a discount code update that names its value or type is refused with a 400, and the code is unchanged @regression', async ({ request }) => {
    const code = await makeCode(request, { type: 'percent', value: 10 });
    for (const change of [{ value: 100 }, { type: 'fixed' }, { code: 'RENAMED' }, { active: false, value: 100 }]) {
      const res = await patchCode(request, code, change);
      expect(res.status(), JSON.stringify(change)).toBe(400);
    }
    const stored = await getCode(request, code);
    expect(stored).toMatchObject({ code, type: 'percent', value: 10, active: true });
  });
});
