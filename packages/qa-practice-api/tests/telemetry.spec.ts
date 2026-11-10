import { test, expect } from '@playwright/test';
import { makeProduct, signUp, PASSWORD } from './design/helpers.ts';
import { newTrace, spansOf, logsOf, children, only, metric, total, SERVER, ERROR, type FlatSpan } from './telemetry.ts';

// OpenTelemetry (src/telemetry.ts): the API sends its traces and metrics to the
// receiver playwright.config.ts starts (scripts/otlp-receiver.ts), and these tests
// read them back. Each request carries its own trace id (newTrace), so the spans a
// test reads are its own request's, even with every other test running at once.
// On Postgres the same tests run, and tests/postgres/traces.spec.ts adds the SQL
// spans and a real lock wait.

const server = (spans: FlatSpan[]) => spans.find((s) => s.kind === SERVER)!;

test.describe('OpenTelemetry traces and metrics', () => {
  test.skip(!!process.env.BASE_URL, 'reads the receiver next to the local test server');

  test('OT-01 an order is one trace: request, order, transaction and a lock for each product @regression', async ({ request }) => {
    const [a, b] = await Promise.all([makeProduct(request), makeProduct(request)]);
    const buyer = await signUp(request);
    const { traceId, headers } = newTrace();
    const res = await request.post('/orders', {
      headers: { ...buyer.auth, ...headers },
      data: { items: [{ product_id: b.id, quantity: 1 }, { product_id: a.id, quantity: 2 }] },
    });
    expect(res.status()).toBe(201);
    const order = await res.json();

    const spans = await spansOf(traceId);
    const http = server(spans);
    // The caller's span is the parent: that is what joins the test and the API in one trace.
    expect(http.parentSpanId).toBe(headers.traceparent.split('-')[2]);
    expect(http).toMatchObject({
      name: 'POST /orders', service: 'qa-practice-api', status: { code: 0 },
      attributes: { 'http.request.method': 'POST', 'http.route': '/orders', 'url.path': '/orders', 'http.response.status_code': 201 },
    });

    const create = only(children(spans, http), 'order.create');
    expect(create).toMatchObject({ status: { code: 0 }, attributes: { 'qa.order.id': order.id, 'qa.order.lines': 2 } });
    const tx = only(children(spans, create), 'db.transaction');
    expect(tx.attributes['qa.transaction.outcome']).toBe('commit');

    // Locked lowest id first (orders.ts lockProducts), whatever order the lines came
    // in. The two products were made at the same time, so either may have the lower id.
    const locks = children(spans, tx).filter((s) => s.name === 'db.lock');
    expect(locks.map((s) => s.attributes['qa.row.id'])).toEqual([a.id, b.id].sort((x, y) => x - y).map(String));
    for (const lock of locks) expect(lock.attributes['db.collection.name']).toBe('products');
  });

  test('OT-02 a refused order marks the order span failed with the reason, but not the request span @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 1 });
    const buyer = await signUp(request);
    const { traceId, headers } = newTrace();
    const res = await request.post('/orders', {
      headers: { ...buyer.auth, ...headers }, data: { items: [{ product_id: product.id, quantity: 2 }] },
    });
    expect(res.status()).toBe(400);

    const spans = await spansOf(traceId);
    const http = server(spans);
    // A 4xx is the caller's mistake: the server span's status stays unset (OpenTelemetry rules).
    expect(http.status.code).toBe(0);
    expect(http.attributes['http.response.status_code']).toBe(400);
    const create = only(children(spans, http), 'order.create');
    expect(create.status).toEqual({ code: ERROR, message: `Insufficient stock for product ${product.id} (available: 1)` });
    expect(create.attributes['qa.order.reject_reason']).toBe('out_of_stock');
    expect(create.attributes['qa.order.id']).toBeUndefined();
  });

  test('OT-03 spans name the route template, not the path with its id; an unknown route has no route @regression', async ({ request }) => {
    const product = await makeProduct(request);
    const known = newTrace();
    expect((await request.get(`/products/${product.id}`, { headers: known.headers })).status()).toBe(200);
    const http = server(await spansOf(known.traceId));
    expect(http.name).toBe('GET /products/:id');
    expect(http.attributes).toMatchObject({ 'http.route': '/products/:id', 'url.path': `/products/${product.id}` });

    const unknown = newTrace();
    expect((await request.get(`/no-such-route/${product.id}`, { headers: unknown.headers })).status()).toBe(404);
    const missing = server(await spansOf(unknown.traceId));
    expect(missing.name).toBe('GET');
    expect(missing.attributes['http.route']).toBeUndefined();
  });

  test('OT-04 the order counters go up and request timings are kept per route template @regression', async ({ request }) => {
    // Other tests place orders at the same time, so a counter can only be checked as
    // going up by at least this test's own orders.
    const created = await total('orders.created');
    const outOfStock = await total('orders.rejected', { 'qa.order.reject_reason': 'out_of_stock' });
    const product = await makeProduct(request, { stock: 3 });
    const buyer = await signUp(request);
    for (let i = 0; i < 3; i++) {
      expect((await request.post('/orders', { headers: buyer.auth, data: { items: [{ product_id: product.id, quantity: 1 }] } })).status()).toBe(201);
    }
    expect((await request.post('/orders', { headers: buyer.auth, data: { items: [{ product_id: product.id, quantity: 1 }] } })).status()).toBe(400);

    await expect.poll(() => total('orders.created'), { timeout: 10_000 }).toBeGreaterThanOrEqual(created + 3);
    await expect.poll(() => total('orders.rejected', { 'qa.order.reject_reason': 'out_of_stock' }), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(outOfStock + 1);

    // Polled too: a request's time is recorded once its reply is sent, after its
    // order was counted, so the counters above can arrive first.
    let duration = await metric('http.server.request.duration');
    await expect.poll(async () => {
      duration = await metric('http.server.request.duration');
      return duration.series.find((s) => s.attributes['http.route'] === '/orders'
        && s.attributes['http.request.method'] === 'POST' && s.attributes['http.response.status_code'] === 201)?.count ?? 0;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    expect(duration.unit).toBe('s');
    // One series per route template: an id in a route would make one per product.
    const routes = duration.series.map((s) => String(s.attributes['http.route'] ?? ''));
    expect(routes.filter((r) => /\d/.test(r))).toEqual([]);
  });

  test('OT-05 no password, token or email reaches a span @regression @security', async ({ request }) => {
    const user = await signUp(request);
    const login = newTrace();
    const res = await request.post('/auth/login', { headers: login.headers, data: { email: user.email, password: PASSWORD } });
    expect(res.status()).toBe(200);
    const { token } = await res.json();
    const me = newTrace();
    expect((await request.get('/auth/me', { headers: { Authorization: `Bearer ${token}`, ...me.headers } })).status()).toBe(200);
    const wrong = newTrace();
    expect((await request.post('/auth/login', { headers: wrong.headers, data: { email: user.email, password: 'Not-the-password-1!' } })).status()).toBe(401);

    const spans = [...await spansOf(login.traceId), ...await spansOf(me.traceId), ...await spansOf(wrong.traceId)];
    const text = JSON.stringify(spans);
    for (const secret of [PASSWORD, 'Not-the-password-1!', token, user.email]) expect(text).not.toContain(secret);
    const keys = spans.flatMap((s) => Object.keys(s.attributes));
    expect(keys.filter((k) => /authorization|password|token|email|cookie/i.test(k))).toEqual([]);
  });

  test('OT-06 a body that is not JSON is a 400 on an unset server span, with no order span @regression', async ({ request }) => {
    const buyer = await signUp(request);
    const { traceId, headers } = newTrace();
    const res = await request.post('/orders', { headers: { ...buyer.auth, ...headers }, data: '{"items": [' });
    expect(res.status()).toBe(400);
    const spans = await spansOf(traceId);
    expect(spans.map((s) => s.name)).toEqual(['POST']);
    expect(server(spans).status.code).toBe(0);
  });

  // Logs (src/telemetry.ts emitLog): a record written during a request carries that
  // request's trace id and the id of the span that was current, so a log search and a
  // trace view can be joined on either.
  test('LG-01 a log line carries the trace id and span id of the order span that wrote it @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 1 });
    const buyer = await signUp(request);
    const { traceId, headers } = newTrace();
    const res = await request.post('/orders', {
      headers: { ...buyer.auth, ...headers }, data: { items: [{ product_id: product.id, quantity: 2 }] },
    });
    expect(res.status()).toBe(400);

    // Found by its text: a later line for the same request must not change which one this reads.
    const log = (await logsOf(traceId)).find((l) => l.body === 'order refused');
    expect(log).toMatchObject({
      traceId, severity: 'WARN', body: 'order refused', service: 'qa-practice-api',
      attributes: { 'qa.order.reject_reason': 'out_of_stock', 'qa.order.lines': 1 },
    });
    const create = only(await spansOf(traceId), 'order.create');
    expect(log!.spanId).toBe(create.spanId);
  });

  test('LG-02 a log line holds no password, token, email or product detail @regression @security', async ({ request }) => {
    const product = await makeProduct(request, { stock: 1 });
    const buyer = await signUp(request);
    const { traceId, headers } = newTrace();
    expect((await request.post('/orders', {
      headers: { ...buyer.auth, ...headers }, data: { items: [{ product_id: product.id, quantity: 2 }] },
    })).status()).toBe(400);

    const text = JSON.stringify(await logsOf(traceId));
    const token = buyer.auth.Authorization.replace('Bearer ', '');
    for (const secret of [PASSWORD, token, buyer.email, `product ${product.id}`]) expect(text).not.toContain(secret);
    expect(Object.keys((await logsOf(traceId))[0]!.attributes).filter((k) => /authorization|password|token|email|cookie/i.test(k))).toEqual([]);
  });
});
