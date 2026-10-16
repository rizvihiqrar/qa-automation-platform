import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createReceiver, startServer } from '../src/receiver.js';
import { HEADERS, sign } from '../src/signature.js';

const SECRET = 'receiver-secret';
const calls = [];
let failNext = 0;
let slowMs = 0;
let server;

before(async () => {
  const { listener } = createReceiver({
    secret: SECRET,
    handler: async (event, id) => {
      if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
      if (failNext > 0) { failNext -= 1; throw new Error('boom'); }
      calls.push({ id, event });
    },
  });
  server = await startServer(listener);
});
after(() => server.close());

/** @param {{ id?: string | null, body?: string, secret?: string, ts?: number, signature?: string, method?: string }} [options] */
async function post({ id = 'evt', body = '{"type":"t"}', secret = SECRET, ts = Math.floor(Date.now() / 1000), signature, method = 'POST' } = {}) {
  const headers = { [HEADERS.timestamp]: String(ts), [HEADERS.signature]: signature ?? sign(secret, ts, body) };
  if (id) headers[HEADERS.id] = id;
  const res = await fetch(server.url, { method, headers, body: method === 'POST' ? body : undefined });
  return { status: res.status, json: await res.json() };
}
const callsFor = (id) => calls.filter((c) => c.id === id).length;

test('a valid delivery is processed once', async () => {
  const res = await post({ id: 'a1' });
  assert.deepEqual(res, { status: 200, json: { status: 'processed' } });
  assert.equal(callsFor('a1'), 1);
});

test('the same delivery id again is acknowledged but not processed twice', async () => {
  await post({ id: 'a2' });
  const res = await post({ id: 'a2' });
  assert.deepEqual(res.json, { status: 'duplicate' });
  assert.equal(callsFor('a2'), 1);
});

test('bad signatures and replayed timestamps get 401 with the reason', async () => {
  assert.deepEqual((await post({ id: 'b1', secret: 'wrong' })).json, { error: 'bad-signature' });
  const old = Math.floor(Date.now() / 1000) - 3600;
  const res = await post({ id: 'b2', ts: old });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'stale-timestamp');
  assert.equal(callsFor('b1') + callsFor('b2'), 0);
});

test('missing id, invalid JSON and wrong method are rejected', async () => {
  assert.equal((await post({ id: null })).status, 400);
  assert.deepEqual((await post({ id: 'c1', body: '{not json' })).json, { error: 'invalid-json' });
  assert.equal((await post({ id: 'c2', method: 'GET' })).status, 405);
});

test('a failed handler answers 500 and leaves the id unprocessed, so a retry works', async () => {
  failNext = 1;
  assert.equal((await post({ id: 'd1' })).status, 500);
  assert.equal(callsFor('d1'), 0);
  assert.deepEqual((await post({ id: 'd1' })).json, { status: 'processed' });
  assert.equal(callsFor('d1'), 1);
});

test('two copies of one delivery arriving together are processed once', async () => {
  slowMs = 150;
  const [r1, r2] = await Promise.all([post({ id: 'e1' }), post({ id: 'e1' })]);
  slowMs = 0;
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(callsFor('e1'), 1);
});
