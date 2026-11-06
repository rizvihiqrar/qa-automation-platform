import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../src/provider.ts';
import { AVA, BEN, SAM, startApi, type Reply } from './helpers.ts';

// What Postman can't see: the provider's own list of charges. The API can say all the
// right things while the card company's books say otherwise.

const api = await startApi();
const ava = await api.login(...AVA);
const ben = await api.login(...BEN);
const sam = await api.login(...SAM);

const live = (orderId: number) => api.shop.provider.active(String(orderId));

test('the provider charges twice: one charge stays, the other is voided', async () => {
  const id = await api.placeOrder(ava);
  const paid = await api.pay(ava, id, 'twice-1', CARDS.chargedTwice);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.duplicates_voided, 1);
  assert.equal(live(id).length, 1);
  assert.equal(api.shop.provider.charges.filter((charge) => charge.reference === String(id)).length, 2);
});

test('a timeout leaves a charge at the provider, and a retry with the same key finds it', async () => {
  const id = await api.placeOrder(ava);
  assert.equal((await api.pay(ava, id, 'slow-1', CARDS.timeout)).status, 504);
  assert.equal(live(id).length, 1, 'the money moved even though the reply never came');
  assert.equal((await api.request('GET', `/orders/${id}`, ava)).body.status, 'placed');

  const retried = await api.pay(ava, id, 'slow-1', CARDS.timeout);
  assert.equal(retried.status, 200);
  assert.equal(live(id).length, 1);
});

test('a retry with a new key after a timeout does not charge again either', async () => {
  const id = await api.placeOrder(ava);
  await api.pay(ava, id, 'slow-2', CARDS.timeout);
  assert.equal((await api.pay(ava, id, 'slow-3', CARDS.timeout)).status, 200);
  assert.equal(live(id).length, 1);
});

test('cancelling after a timeout voids the charge waiting at the provider', async () => {
  const id = await api.placeOrder(ava);
  await api.pay(ava, id, 'slow-4', CARDS.timeout);
  assert.equal((await api.request('POST', `/orders/${id}/cancel`, ava, {})).status, 200);
  assert.equal(live(id).length, 0);
});

test('after a timeout, a different card that is declined stays declined and leaves no charge', async () => {
  const id = await api.placeOrder(ava);
  await api.pay(ava, id, 'slow-5', CARDS.timeout);
  const declined = await api.pay(ava, id, 'slow-6', CARDS.declined);
  assert.equal(declined.status, 402);
  assert.equal(live(id).length, 0);
  assert.equal((await api.request('GET', `/orders/${id}`, ava)).body.status, 'placed');
});

test('after a timeout, a different good card pays once, on that card', async () => {
  const id = await api.placeOrder(ava);
  await api.pay(ava, id, 'slow-7', CARDS.timeout);
  const paid = await api.pay(ava, id, 'slow-8', CARDS.approved);
  assert.equal(paid.body.card_last4, '4242');
  assert.deepEqual(live(id).map((charge) => charge.card_last4), ['4242']);
});

// Starts a charge and holds it open at the provider until the other requests have had
// their answer, or have reached the point of waiting for it, so the overlap is certain.
async function whileCharging(start: () => Promise<Reply>, during: () => Promise<Reply>[]): Promise<Reply[]> {
  const { provider } = api.shop;
  let release = (): void => {};
  provider.gate = new Promise((resolve) => { release = resolve; });
  const calls = provider.calls;
  const first = start();
  while (provider.calls === calls) await new Promise((resolve) => setImmediate(resolve));
  const others = during();
  await Promise.race([Promise.all(others), new Promise((resolve) => setTimeout(resolve, 100))]);
  provider.gate = null;
  release();
  return Promise.all([first, ...others]);
}

test('five requests at once with the same key make one charge and one result', async () => {
  const id = await api.placeOrder(ava);
  const send = () => api.pay(ava, id, 'same-1', CARDS.approved);
  const replies = await whileCharging(send, () => [send(), send(), send(), send()]);
  assert.deepEqual(replies.map((reply) => reply.status), [200, 200, 200, 200, 200]);
  assert.equal(new Set(replies.map((reply) => reply.body.id)).size, 1);
  assert.equal(live(id).length, 1);
});

test('a second payment with a new key during a running one is refused', async () => {
  const id = await api.placeOrder(ava);
  const [paid, second] = await whileCharging(() => api.pay(ava, id, 'race-1', CARDS.approved), () => [api.pay(ava, id, 'race-2', CARDS.approved)]);
  assert.equal(paid!.status, 200);
  assert.equal(second!.status, 409);
  assert.equal(second!.body.code, 'payment_in_progress');
  assert.equal(live(id).length, 1);
});

test('a cancel during a running payment is refused', async () => {
  const id = await api.placeOrder(ava);
  const [paid, cancelled] = await whileCharging(() => api.pay(ava, id, 'race-3', CARDS.approved), () => [api.request('POST', `/orders/${id}/cancel`, ava)]);
  assert.equal(paid!.status, 200);
  assert.equal(cancelled!.body.code, 'payment_in_progress');
  assert.equal((await api.request('GET', `/orders/${id}`, ava)).body.status, 'paid');
});

test('cancelling a paid order gives the money back at the provider too', async () => {
  const id = await api.placeOrder(ava);
  const { amount_cents: total } = (await api.pay(ava, id, 'back-1', CARDS.approved)).body;
  assert.equal(api.shop.provider.heldCents(String(id)), total);
  const cancelled = await api.request('POST', `/orders/${id}/cancel`, ava);
  assert.equal(cancelled.body.refunded_cents, total);
  assert.equal(api.shop.provider.heldCents(String(id)), 0);
});

test('a partial refund, then a cancel, gives back exactly what was paid', async () => {
  const id = await api.placeOrder(ava);
  const { amount_cents: total } = (await api.pay(ava, id, 'back-2', CARDS.approved)).body;
  await api.request('POST', `/orders/${id}/refund`, sam, { amount_cents: 100 });
  assert.equal(api.shop.provider.heldCents(String(id)), total - 100);
  const cancelled = await api.request('POST', `/orders/${id}/cancel`, ava);
  assert.equal(cancelled.body.refunded_cents, total);
  assert.equal(api.shop.provider.heldCents(String(id)), 0);
});

test('a refund with no amount and nothing left is refused as over the paid total', async () => {
  const id = await api.placeOrder(ava);
  await api.pay(ava, id, 'back-3', CARDS.approved);
  assert.equal((await api.request('POST', `/orders/${id}/refund`, sam)).status, 200);
  const empty = await api.request('POST', `/orders/${id}/refund`, sam);
  assert.equal(empty.status, 422);
  assert.equal(empty.body.code, 'refund_exceeds_paid');
});

test('a replayed decline does not reach the provider', async () => {
  const id = await api.placeOrder(ava);
  await api.pay(ava, id, 'no-1', CARDS.declined);
  const calls = api.shop.provider.calls;
  const replay = await api.pay(ava, id, 'no-1', CARDS.declined);
  assert.equal(replay.status, 402);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  assert.equal(api.shop.provider.calls, calls);
});

test('a key belongs to its sender: two customers can use the same one', async () => {
  const mine = await api.placeOrder(ava);
  const theirs = await api.placeOrder(ben);
  assert.equal((await api.pay(ava, mine, 'shared-1', CARDS.approved)).status, 200);
  assert.equal((await api.pay(ben, theirs, 'shared-1', CARDS.approved)).status, 200);
});

test('refunds never pass the paid total, however they are split', async () => {
  const id = await api.placeOrder(ava);
  const total = (await api.pay(ava, id, 'refund-1', CARDS.approved)).body.amount_cents;
  assert.equal((await api.request('POST', `/orders/${id}/refund`, sam, { amount_cents: total - 1 })).status, 200);
  assert.equal((await api.request('POST', `/orders/${id}/refund`, sam, { amount_cents: 2 })).status, 422);
  assert.equal((await api.request('POST', `/orders/${id}/refund`, sam, { amount_cents: 1 })).status, 200);
  assert.equal((await api.request('POST', `/orders/${id}/refund`, sam, { amount_cents: 1 })).status, 422);
  assert.equal((await api.request('GET', `/orders/${id}`, sam)).body.refunded_cents, total);
});

test('a refund must be a whole, positive number of cents', async () => {
  const id = await api.placeOrder(ava);
  await api.pay(ava, id, 'refund-2', CARDS.approved);
  for (const amount_cents of [0, -5, 1.5, '100', null]) {
    const reply = await api.request('POST', `/orders/${id}/refund`, sam, { amount_cents });
    assert.equal(reply.status, 400, String(amount_cents));
    assert.equal(reply.body.code, 'invalid_amount');
  }
});

test('the card number is never kept or sent back', async () => {
  const id = await api.placeOrder(ava);
  const paid = await api.pay(ava, id, 'card-1', CARDS.approved);
  assert.equal(paid.body.card_last4, '4242');
  assert.ok(!JSON.stringify(paid.body).includes(CARDS.approved));
  assert.ok(!JSON.stringify(api.shop.provider.charges).includes(CARDS.approved));
});
