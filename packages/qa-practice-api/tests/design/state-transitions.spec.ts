// State-transition testing of the order lifecycle: every (from, to) pair of the
// five statuses, so each allowed move and each forbidden one is tried once. The
// diagram and table are in docs/test-strategy/test-plan.md.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { signUp, admin, makeProduct, stockOf, type Account } from './helpers.ts';

type Status = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

// The allowed moves that reach each status from a new (pending) order.
const PATH_TO: Record<Status, Status[]> = {
  pending:    [],
  processing: ['processing'],
  shipped:    ['processing', 'shipped'],
  delivered:  ['processing', 'shipped', 'delivered'],
  cancelled:  ['cancelled'],
};

// A customer places each order and the admin moves it: the lifecycle rules are the
// same for everyone allowed to make a move (who may make which move is in
// tests/design/access-control.spec.ts).
let account: Account;
test.beforeAll(async ({ request }) => { account = await signUp(request); });

async function orderIn(request: APIRequestContext, status: Status, quantity = 1) {
  const p = await makeProduct(request, { stock: 10 });
  const res = await request.post('/orders', { headers: account.auth, data: { items: [{ product_id: p.id, quantity }] } });
  const order = await res.json();
  for (const step of PATH_TO[status]) {
    const moved = await request.patch(`/orders/${order.id}/status`, { headers: admin().auth, data: { status: step } });
    if (moved.status() !== 200) throw new Error(`setup: could not move order to ${step}: ${moved.status()}`);
  }
  return { orderId: order.id as number, productId: p.id };
}

const changeStatus = (request: APIRequestContext, orderId: number, status: Status) =>
  request.patch(`/orders/${orderId}/status`, { headers: admin().auth, data: { status } });

test.describe('every status change', () => {
  const cases: [id: string, from: Status, to: Status, status: 200 | 409][] = [
    ['TC-ST-01', 'pending',    'pending',    409],
    ['TC-ST-02', 'pending',    'processing', 200],
    ['TC-ST-03', 'pending',    'shipped',    409],
    ['TC-ST-04', 'pending',    'delivered',  409],
    ['TC-ST-05', 'pending',    'cancelled',  200],
    ['TC-ST-06', 'processing', 'pending',    409],
    ['TC-ST-07', 'processing', 'processing', 409],
    ['TC-ST-08', 'processing', 'shipped',    200],
    ['TC-ST-09', 'processing', 'delivered',  409],
    ['TC-ST-10', 'processing', 'cancelled',  200],
    ['TC-ST-11', 'shipped',    'pending',    409],
    ['TC-ST-12', 'shipped',    'processing', 409],
    ['TC-ST-13', 'shipped',    'shipped',    409],
    ['TC-ST-14', 'shipped',    'delivered',  200],
    ['TC-ST-15', 'shipped',    'cancelled',  409],
    ['TC-ST-16', 'delivered',  'pending',    409],
    ['TC-ST-17', 'delivered',  'processing', 409],
    ['TC-ST-18', 'delivered',  'shipped',    409],
    ['TC-ST-19', 'delivered',  'delivered',  409],
    ['TC-ST-20', 'delivered',  'cancelled',  409],
    ['TC-ST-21', 'cancelled',  'pending',    409],
    ['TC-ST-22', 'cancelled',  'processing', 409],
    ['TC-ST-23', 'cancelled',  'shipped',    409],
    ['TC-ST-24', 'cancelled',  'delivered',  409],
    ['TC-ST-25', 'cancelled',  'cancelled',  409],
  ];
  for (const [id, from, to, status] of cases) {
    test(`${id} ${from} -> ${to} returns ${status} @regression`, async ({ request }) => {
      const { orderId } = await orderIn(request, from);
      const res = await changeStatus(request, orderId, to);
      expect(res.status()).toBe(status);
      const body = await res.json();
      if (status === 200) expect(body.status).toBe(to);
      else expect(body.error).toBe(`Cannot change order status from ${from} to ${to}`);
      const now = await (await request.get(`/orders/${orderId}`, { headers: account.auth })).json();
      expect(now.status).toBe(status === 200 ? to : from);
    });
  }
});

test.describe('stock on cancel', () => {
  const cases: [id: string, from: Status][] = [
    ['TC-ST-26', 'pending'],
    ['TC-ST-27', 'processing'],
  ];
  for (const [id, from] of cases) {
    test(`${id} cancelling a ${from} order returns its stock @regression`, async ({ request }) => {
      const { orderId, productId } = await orderIn(request, from, 4);
      expect(await stockOf(request, productId)).toBe(6);
      expect((await changeStatus(request, orderId, 'cancelled')).status()).toBe(200);
      expect(await stockOf(request, productId)).toBe(10);
    });
  }

  test('TC-ST-28 a refused cancel (shipped order) leaves stock as it was @regression', async ({ request }) => {
    const { orderId, productId } = await orderIn(request, 'shipped', 4);
    expect((await changeStatus(request, orderId, 'cancelled')).status()).toBe(409);
    expect(await stockOf(request, productId)).toBe(6);
  });

  test('TC-ST-29 cancelling after the product was deleted still succeeds @regression', async ({ request }) => {
    const { orderId, productId } = await orderIn(request, 'pending', 4);
    expect((await request.delete(`/products/${productId}`, { headers: admin().auth })).status()).toBe(204);
    const res = await changeStatus(request, orderId, 'cancelled');
    expect(res.status()).toBe(200);
    expect((await request.get(`/products/${productId}`)).status()).toBe(404);
  });
});
