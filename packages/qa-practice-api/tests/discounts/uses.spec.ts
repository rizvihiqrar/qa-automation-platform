// State transitions of a code's uses (DC-R21 to DC-R23): an order with the code
// counts while it is pending, processing, shipped or delivered, and stops counting
// when it is cancelled. The last case sends ten orders for the last use at once.
import { test, expect } from '@playwright/test';
import { signUp, admin, makeProduct, makeCode, getCode, order, cancel } from './helpers.ts';

const move = (request: Parameters<typeof getCode>[0], orderId: number, status: string) =>
  request.patch(`/orders/${orderId}/status`, { headers: admin().auth, data: { status } });

test('DC-ST-01 [DC-R21] placing an order with the code counts one use @regression', async ({ request }) => {
  const p = await makeProduct(request);
  const code = await makeCode(request);
  expect((await getCode(request, code)).uses).toBe(0);
  expect((await order(request, await signUp(request), p.id, 1, code)).status()).toBe(201);
  expect((await getCode(request, code)).uses).toBe(1);
});

test('DC-ST-02 [DC-R23] cancelling gives the use back, and the customer may use the code again @regression', async ({ request }) => {
  const [me, p] = [await signUp(request), await makeProduct(request)];
  const code = await makeCode(request);
  const first = await (await order(request, me, p.id, 1, code)).json();
  expect((await cancel(request, me, first.id)).status()).toBe(200);
  expect((await getCode(request, code)).uses).toBe(0);
  expect((await order(request, me, p.id, 1, code)).status()).toBe(201);
  expect((await getCode(request, code)).uses).toBe(1);
});

test('DC-ST-03 [DC-R23] a cancelled order frees the last use for another customer @regression', async ({ request }) => {
  const p = await makeProduct(request);
  const code = await makeCode(request, { max_uses: 1 });
  const [a, b] = [await signUp(request), await signUp(request)];
  const first = await (await order(request, a, p.id, 1, code)).json();
  expect((await order(request, b, p.id, 1, code)).status()).toBe(422);
  await cancel(request, a, first.id);
  expect((await order(request, b, p.id, 1, code)).status()).toBe(201);
});

test('DC-ST-04 [DC-R22] an order still counts once processing, shipped and delivered @regression', async ({ request }) => {
  const [me, p] = [await signUp(request), await makeProduct(request)];
  const code = await makeCode(request);
  const placed = await (await order(request, me, p.id, 1, code)).json();
  for (const status of ['processing', 'shipped', 'delivered']) {
    expect((await move(request, placed.id, status)).status()).toBe(200);
    expect((await getCode(request, code)).uses).toBe(1);
    const again = await order(request, me, p.id, 1, code);
    expect(again.status(), status).toBe(422);
    expect((await again.json()).error).toBe('You have already used this discount code');
  }
});

test('DC-ST-05 [DC-R22] the once-per-customer rule is per customer: two customers count two uses @regression', async ({ request }) => {
  const p = await makeProduct(request);
  const code = await makeCode(request);
  for (let i = 0; i < 2; i++) expect((await order(request, await signUp(request), p.id, 1, code)).status()).toBe(201);
  expect((await getCode(request, code)).uses).toBe(2);
});

test('DC-ST-06 [DC-R21] ten customers at once for the last use: exactly one gets it @regression', async ({ request }) => {
  const p = await makeProduct(request, { stock: 20 });
  const code = await makeCode(request, { max_uses: 1 });
  const customers = await Promise.all(Array.from({ length: 10 }, () => signUp(request)));
  const statuses = (await Promise.all(customers.map((c) => order(request, c, p.id, 1, code)))).map((r) => r.status());
  expect(statuses.filter((s) => s === 201)).toHaveLength(1);
  expect(statuses.filter((s) => s === 422)).toHaveLength(9);
  expect((await getCode(request, code)).uses).toBe(1);
});
