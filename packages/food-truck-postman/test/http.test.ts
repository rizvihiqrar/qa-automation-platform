import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVA, startApi } from './helpers.ts';

// The edges of the HTTP layer, which the collection doesn't reach.

const api = await startApi();
const ava = await api.login(...AVA);

test('a path no URL parser likes is a 404, not a server fault', async () => {
  const reply = await api.request('GET', '//');
  assert.equal(reply.status, 404);
  assert.equal(reply.body.code, 'not_found');
});

test('sign-in comes before the body: a stranger with a bad body gets 401', async () => {
  const res = await fetch(`${api.base}/orders`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'not json' });
  assert.equal(res.status, 401);
});

test('a body too large is refused and closes the connection, and the next request works', async () => {
  const reply = await api.request('POST', '/orders', ava, { filler: 'x'.repeat(20 * 1024) });
  assert.equal(reply.status, 413);
  assert.equal(reply.headers.get('connection'), 'close');
  assert.equal((await api.request('GET', '/health')).status, 200);
});

test('a route that needs no body works without one', async () => {
  const id = await api.placeOrder(ava);
  assert.equal((await api.request('POST', `/orders/${id}/cancel`, ava)).status, 200);
});
