import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliver, backoffDelays } from '../src/sender.js';
import { createReceiver, startServer } from '../src/receiver.js';
import { HEADERS, verify } from '../src/signature.js';

// A fake network: returns the given statuses in order (an Error means a network failure)
// and records every request.
function fakeFetch(statuses) {
  const requests = [];
  const impl = async (url, init) => {
    requests.push(init);
    const next = statuses[Math.min(requests.length - 1, statuses.length - 1)];
    if (next instanceof Error) throw next;
    return { status: next };
  };
  return { impl, requests };
}
const recordSleep = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };
const base = { url: 'http://x/hook', secret: 'k', event: { type: 't' } };

test('backoff doubles each time', () => {
  assert.deepEqual(backoffDelays(5, 200), [200, 400, 800, 1600]);
});

test('success on the first attempt does not wait', async () => {
  const net = fakeFetch([200]);
  const { waits, sleep } = recordSleep();
  const r = await deliver({ ...base, fetchImpl: net.impl, sleep });
  assert.equal(r.delivered, true);
  assert.equal(r.attempts.length, 1);
  assert.deepEqual(waits, []);
});

test('server errors are retried with backoff until it works', async () => {
  const net = fakeFetch([503, 502, 200]);
  const { waits, sleep } = recordSleep();
  const r = await deliver({ ...base, fetchImpl: net.impl, sleep });
  assert.equal(r.delivered, true);
  assert.deepEqual(r.attempts.map((a) => a.status), [503, 502, 200]);
  assert.deepEqual(waits, [200, 400]);
});

test('network errors, 408 and 429 are retried', async () => {
  const net = fakeFetch([new Error('ECONNRESET'), 429, 408, 204]);
  const r = await deliver({ ...base, fetchImpl: net.impl, sleep: recordSleep().sleep });
  assert.equal(r.delivered, true);
  assert.equal(r.attempts[0].error, 'ECONNRESET');
  assert.equal(r.attempts.length, 4);
});

test('other client errors stop immediately', async () => {
  for (const status of [400, 401, 404, 422]) {
    const net = fakeFetch([status]);
    const r = await deliver({ ...base, fetchImpl: net.impl, sleep: recordSleep().sleep });
    assert.equal(r.reason, 'rejected', `status ${status}`);
    assert.equal(net.requests.length, 1);
  }
});

test('it gives up after maxAttempts', async () => {
  const net = fakeFetch([500]);
  const { waits, sleep } = recordSleep();
  const r = await deliver({ ...base, fetchImpl: net.impl, sleep, maxAttempts: 3 });
  assert.deepEqual([r.delivered, r.reason, r.attempts.length], [false, 'gave-up', 3]);
  assert.deepEqual(waits, [200, 400]);
});

test('the delivery id stays the same while each retry is re-signed with a fresh timestamp', async () => {
  const net = fakeFetch([500, 200]);
  let clock = 1_800_000_000_000;
  const r = await deliver({ ...base, fetchImpl: net.impl, sleep: async () => { clock += 5000; }, nowMs: () => clock });
  const [a, b] = net.requests.map((req) => req.headers);
  assert.equal(a[HEADERS.id], r.id);
  assert.equal(b[HEADERS.id], r.id);
  assert.notEqual(a[HEADERS.timestamp], b[HEADERS.timestamp]);
  assert.notEqual(a[HEADERS.signature], b[HEADERS.signature]);
  const check = verify({ secret: 'k', body: net.requests[1].body, timestamp: b[HEADERS.timestamp], signature: b[HEADERS.signature], nowMs: clock });
  assert.equal(check.ok, true);
});

test('end to end: a receiver failing twice still processes the event exactly once', async () => {
  let failures = 2;
  let processed = 0;
  const { listener } = createReceiver({ secret: 'e2e', handler: () => { if (failures-- > 0) throw new Error('busy'); processed += 1; } });
  const server = await startServer(listener);
  try {
    const r = await deliver({ url: server.url, secret: 'e2e', event: { type: 'order.paid' }, sleep: async () => {} });
    assert.deepEqual(r.attempts.map((a) => a.status), [500, 500, 200]);
    const again = await deliver({ url: server.url, secret: 'e2e', event: { type: 'order.paid' }, id: r.id, sleep: async () => {} });
    assert.equal(again.delivered, true);
    assert.equal(processed, 1);
  } finally {
    await server.close();
  }
});
