import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { send, startWire, type Flow, type Seen } from './proxy.ts';
import { wireProblems } from './wire.ts';

// Network inspection with a proxy (A320): mitmproxy in Docker sits between the client
// and a real banking-api server, records every request and reply, and can change a
// request in flight. These tests read the recording, so they check what was on the
// wire, not what the code says it sends. Needs Docker (`npm run test:proxy`).

const wire = await startWire();

// Every call goes through here, so the tests can set what the client got beside what
// the proxy recorded, call by call.
const calls: { path: string; seen: Seen }[] = [];
async function go(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Seen> {
  const seen = await send(wire.base, method, path, body, headers);
  calls.push({ path, seen });
  return seen;
}

async function account(owner: string, currency = 'CAD', deposit?: string): Promise<number> {
  const opened = await go('POST', '/accounts', { owner, currency });
  assert.equal(opened.status, 201, opened.text);
  if (deposit) assert.equal((await go('POST', `/accounts/${opened.body.id}/deposits`, { amount: deposit, currency })).status, 201);
  return opened.body.id;
}
const balance = async (id: number) => (await go('GET', `/accounts/${id}`)).body.balance as string;
const transfer = (from: number, to: number, amount: string, extra: Record<string, unknown> = {}, key?: string) =>
  go('POST', '/transfers', { from_account_id: from, to_account_id: to, amount, currency: 'CAD', ...extra }, key ? { 'Idempotency-Key': key } : {});
const headersOf = (flow: Flow, name: string) => flow.request_headers.filter(([k]) => k.toLowerCase() === name).map(([, v]) => v);
const transfersWritten = () => Number((wire.ledger.db.prepare("SELECT COUNT(*) AS n FROM transfers WHERE kind = 'transfer'").get() as { n: number }).n);

// What the UI sends: its three files, then the calls its forms make, including the
// refusals the forms show.
const SECRETS = ['Wire Tester', 'Zoë 77', '4321.09', 'WIRE-REF-9'];
const SESSION_KEY = `wire-session-${process.pid}-${Date.now()}`;

describe('what a client session puts on the wire', () => {
  test('a whole session goes through the proxy, and every reply is recorded just as the client got it', async () => {
    await go('GET', '/');
    await go('GET', '/app.js');
    await go('GET', '/app.css');
    const a = await account('Wire Tester', 'CAD', '5000.00');
    const b = await account('Zoë 77');
    await go('GET', '/accounts');
    await go('GET', `/accounts/${a}`);
    await transfer(a, b, '4321.09', { reference: 'WIRE-REF-9' }, SESSION_KEY);
    await transfer(a, b, '4321.09', { reference: 'WIRE-REF-9' }, SESSION_KEY); // the lost-reply retry
    await go('GET', `/accounts/${a}/entries`);
    await go('GET', '/transfers/1');
    await transfer(a, b, '99999.00'); // refused: not enough money
    await transfer(a, a, '1.00'); // refused: same account
    await go('POST', '/transfers', { from_account_id: a, to_account_id: b, amount: 12.5, currency: 'CAD' }); // refused: a number
    await go('GET', '/accounts/999'); // an unknown account
    await go('DELETE', `/accounts/${a}`); // the wrong method
    await go('POST', '/accounts', '{not json}'); // an unreadable body

    const flows = wire.flows();
    assert.equal(flows.length, calls.length, 'one recording per request');
    flows.forEach((flow, i) => {
      const { path, seen } = calls[i]!;
      assert.equal(flow.path, path, `call ${i}`);
      assert.equal(flow.status, seen.status, `${path}: status`);
      assert.equal(flow.response_body, seen.text, `${path}: body`);
    });
    assert.deepEqual(flows.map((f) => f.status).filter((s) => s >= 400), [422, 422, 400, 404, 405, 400], 'the six refusals were on the wire');
  });

  test('BK-R41 no URL has a query string, an amount, a name or a reference in it, and no reply sets a cookie or names its server', () => {
    assert.deepEqual(wireProblems(wire.flows(), SECRETS), []);
  });

  test('BK-R41 the amount, the owner and the reference travel in the body, as text, and the key in a header', () => {
    const sent = wire.flows().filter((f) => f.method === 'POST' && f.path === '/transfers' && headersOf(f, 'idempotency-key').includes(SESSION_KEY));
    assert.equal(sent.length, 2, 'the transfer and its retry');
    for (const flow of sent) {
      const body = JSON.parse(flow.request_body);
      assert.equal(body.amount, '4321.09'); // a string, not a number
      assert.equal(body.reference, 'WIRE-REF-9');
      assert.ok(!flow.request_body.includes(SESSION_KEY), 'the key is a header, not part of the body');
    }
    const opened = wire.flows().find((f) => f.method === 'POST' && f.path === '/accounts');
    assert.equal(JSON.parse(opened!.request_body).owner, 'Wire Tester');
  });

  test('BK-R20 BK-R41 the retry on the wire is answered as a replay with the first reply, and says so', () => {
    const [first, again] = wire.flows().filter((f) => f.path === '/transfers' && headersOf(f, 'idempotency-key').includes(SESSION_KEY));
    assert.equal(first!.status, 201);
    assert.equal(again!.status, 201);
    assert.equal(again!.response_body, first!.response_body);
    assert.ok(!first!.response_headers.some(([k]) => k.toLowerCase() === 'idempotent-replayed'));
    assert.deepEqual(again!.response_headers.filter(([k]) => k.toLowerCase() === 'idempotent-replayed').map(([, v]) => v), ['true']);
  });

  test('BK-R32 the three UI files on the wire name no other origin, and nothing in them loads from one', () => {
    for (const path of ['/', '/app.js', '/app.css']) {
      const flow = wire.flows().find((f) => f.path === path)!;
      assert.equal(flow.status, 200, path);
      assert.doesNotMatch(flow.response_body, /(?:https?:)?\/\/[\w.-]+\.\w/, `${path} mentions another origin`);
    }
  });
});

describe('replaying and changing a request that went by', () => {
  test('BK-R20 a transfer captured on the wire replays from the capture, straight at the server: the same answer, one movement', async () => {
    const from = await account('Replay From', 'CAD', '100.00');
    const to = await account('Replay To');
    const key = `wire-replay-${process.pid}-${Date.now()}`;
    const first = await transfer(from, to, '10.00', { reference: 'REPLAY-1' }, key);
    assert.equal(first.status, 201);

    const captured = wire.flows().findLast((f) => f.path === '/transfers' && headersOf(f, 'idempotency-key').includes(key))!;
    const replay = await fetch(`${wire.api}${captured.path}`, {
      method: captured.method,
      headers: Object.fromEntries(captured.request_headers.filter(([k]) => !['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'accept-encoding'].includes(k.toLowerCase()))),
      body: captured.request_body,
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.deepEqual(await replay.json(), first.body);
    assert.equal(await balance(from), '90.00');
    assert.equal(await balance(to), '10.00');
  });

  for (const [label, change] of [
    ['a different amount', { amount: '10.01' }],
    ['another receiving account', { to_account_id: 1 }],
    ['another reference', { reference: 'REPLAY-2' }],
    ['no reference', { reference: undefined }],
    ['another currency', { currency: 'USD' }],
  ] as const) {
    test(`BK-R21 the same captured request with ${label} is 422 idempotency_key_mismatch, and moves nothing`, async () => {
      const from = await account('Edit From', 'CAD', '100.00');
      const to = await account('Edit To');
      const key = `wire-edit-${process.pid}-${Date.now()}-${label.length}`;
      assert.equal((await transfer(from, to, '10.00', { reference: 'REPLAY-1' }, key)).status, 201);
      const captured = wire.flows().findLast((f) => headersOf(f, 'idempotency-key').includes(key))!;
      const edited = JSON.stringify({ ...JSON.parse(captured.request_body), ...change });
      const reply = await fetch(`${wire.api}/transfers`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: edited });
      assert.equal(reply.status, 422);
      assert.equal(((await reply.json()) as { code: string }).code, 'idempotency_key_mismatch');
      assert.equal(await balance(from), '90.00');
    });
  }

  test('BK-R21 the key of a transfer on a deposit route is a mismatch too: a key belongs to one request, not to an account', async () => {
    const from = await account('Route From', 'CAD', '100.00');
    const to = await account('Route To');
    const key = `wire-route-${process.pid}-${Date.now()}`;
    assert.equal((await transfer(from, to, '10.00', {}, key)).status, 201);
    const reply = await go('POST', `/accounts/${to}/deposits`, { amount: '10.00', currency: 'CAD' }, { 'Idempotency-Key': key });
    assert.equal(reply.status, 422);
    assert.equal(reply.body.code, 'idempotency_key_mismatch');
    assert.equal(await balance(to), '10.00');
  });
});

describe('a request changed on its way', () => {
  test('BK-R21 BK-R20 the proxy raises the amount in flight: the server pays what it received, and the key no longer repeats what the client meant', async () => {
    const from = await account('Tamper From', 'CAD', '100.00');
    const to = await account('Tamper To');
    const key = `wire-tamper-${process.pid}-${Date.now()}`;
    wire.tamper({ method: 'POST', path: '/transfers', field: 'amount', value: '20.00' });
    let reply: Seen;
    try {
      reply = await transfer(from, to, '10.00', {}, key); // the client asks for 10.00
    } finally {
      wire.tamper(null);
    }
    // The server has no way to tell: it moved what reached it, and says so in the reply.
    assert.equal(reply.status, 201);
    assert.equal(reply.body.amount, '20.00');
    const flow = wire.flows().findLast((f) => headersOf(f, 'idempotency-key').includes(key))!;
    assert.deepEqual(flow.changed, { amount: '10.00' }, 'the proxy recorded what the client had sent');
    assert.equal(JSON.parse(flow.request_body).amount, '20.00', 'and what the server received');
    assert.equal(await balance(from), '80.00');
    // What protects the client is checking the reply, and the key: asking again for the
    // 10.00 it meant is not a replay of the 20.00 that was paid.
    const again = await transfer(from, to, '10.00', {}, key);
    assert.equal(again.status, 422);
    assert.equal(again.body.code, 'idempotency_key_mismatch');
    assert.equal(await balance(from), '80.00');
  });

  test('BK-R39 a payment raised past the limit in flight is refused, whatever the client sent', async () => {
    const from = await account('Limit From', 'CAD', '20000.00');
    const to = await account('Limit To');
    const written = transfersWritten();
    wire.tamper({ method: 'POST', path: '/transfers', field: 'amount', value: '10000.01' });
    try {
      const reply = await transfer(from, to, '10.00');
      assert.equal(reply.status, 422);
      assert.equal(reply.body.code, 'payment_limit');
    } finally {
      wire.tamper(null);
    }
    assert.equal(transfersWritten(), written);
    assert.equal(await balance(from), '20000.00');
  });

  test('BK-R38 a reference changed to something outside the alphabet in flight is refused, and nothing is written', async () => {
    const from = await account('Ref From', 'CAD', '100.00');
    const to = await account('Ref To');
    const written = transfersWritten();
    wire.tamper({ method: 'POST', path: '/transfers', field: 'reference', value: 'x#<script>' });
    try {
      const reply = await transfer(from, to, '10.00', { reference: 'OK-1' });
      assert.equal(reply.status, 400);
      assert.equal(reply.body.code, 'invalid_reference');
    } finally {
      wire.tamper(null);
    }
    assert.equal(transfersWritten(), written);
  });

  test('BK-R41 after all of it the wire is still clean: nothing in any URL or header went wrong, whatever was sent', () => {
    assert.deepEqual(wireProblems(wire.flows(), ['Tamper From', 'Limit From', 'x#<script>']), []);
  });
});
