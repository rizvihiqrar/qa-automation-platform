import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import pg from 'pg';
import { makeProduct, signUp } from '../design/helpers.ts';
import { ADMIN } from '../admin.ts';

// LOGIN_ATTEMPTS in src/routes/auth.ts (not imported: that would open the store,
// and a database pool, inside the test process).
const LOGIN_ATTEMPTS = 5;
import { newTrace, spansOf, receiverPort, SERVER, ERROR, type FlatSpan } from '../telemetry.ts';

// Day 51, only on Postgres. scripts/with-postgres.ts starts Toxiproxy between a
// second API server (started here) and the database, and these tests tell it to
// slow the line down, cut it, or make it go silent. The suite's own server keeps
// its direct line (DATABASE_URL), so the other tests never see a fault; data is
// set up through that server and read through this one (one database).
//
// The tests in this file run one at a time: a fault hits every connection on the
// line. Each Playwright worker has a line of its own (postgres-0, postgres-1...),
// so copies of this file in other workers (--repeat-each in burn-in) can't meet.

const { DATABASE_URL, TOXIPROXY_URL, TOXIPROXY_DATABASE_URLS = '' } = process.env;
const lines = TOXIPROXY_DATABASE_URLS.split(' ').filter(Boolean);
let proxy = ''; // this worker's line, set in beforeAll

// Short timeouts, so the tests don't wait long (src/db/postgres.ts).
const CONNECT_TIMEOUT = 1000;
const QUERY_TIMEOUT = 1500;
const RETRY_DELAY = 500;

test.describe.configure({ mode: 'serial' });
test.skip(!TOXIPROXY_URL, 'needs Toxiproxy from scripts/with-postgres.ts');

// Toxiproxy's control API, for this worker's line: https://github.com/Shopify/toxiproxy#http-api
async function toxiproxy(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${TOXIPROXY_URL}/proxies/${proxy}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`Toxiproxy ${method} ${proxy}${path}: ${res.status} ${await res.text()}`);
  return method === 'GET' ? res.json() : undefined;
}
// A "toxic" changes what passes on the line: downstream is Postgres's answers.
const addToxic = (name: string, type: string, attributes: Record<string, number>) =>
  toxiproxy('POST', '/toxics', { name, type, stream: 'downstream', attributes });
const removeToxic = (name: string) => toxiproxy('DELETE', `/toxics/${name}`);
// A disabled proxy hangs up every connection on the line and refuses new ones.
const setLine = (enabled: boolean) => toxiproxy('POST', '', { enabled });

async function sql<T = any>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

// A transaction of the test's own, on the direct line, that holds what `take`
// locks until it ends. Resolves once the API's statement waits for it, so the
// fault can be put on the line while that statement is surely in flight.
async function holdUntilBlocked(take: (client: pg.Client) => Promise<unknown>, blocked: () => Promise<APIResponse>) {
  const holder = new pg.Client({ connectionString: DATABASE_URL });
  await holder.connect();
  await holder.query('BEGIN');
  await take(holder);
  const { rows: [{ pid }] } = await holder.query('SELECT pg_backend_pid() AS pid');
  const response = blocked();
  let waiting: number[] = [];
  await expect.poll(async () => {
    const { rows } = await holder.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid]);
    waiting = rows.map((r) => r.pid);
    return waiting.length;
  }, { timeout: 10_000, message: 'the API never waited for the lock: did its request fail first?' }).toBe(1);
  return {
    response,
    release: async (how: 'COMMIT' | 'ROLLBACK') => {
      await holder.query(how);
      await holder.end();
    },
    // Resolves once the API's waiting connection is gone from Postgres: the cut
    // has happened, so the fault can come off before any retry (500 ms later).
    cutDone: () => expect.poll(async () => (await sql('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1', [waiting[0]]))[0].n,
      { timeout: 5_000, intervals: [20] }).toBe(0),
  };
}

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, () => {
    const { port } = s.address() as { port: number };
    s.close(() => resolve(port));
  });
});

let server: ChildProcess;
let api: string;
let log = '';

test.beforeAll(async ({}, testInfo) => {
  const line = lines[testInfo.parallelIndex];
  if (!line) throw new Error(`no Toxiproxy line for worker ${testInfo.parallelIndex}: with-postgres.ts makes ${lines.length}`);
  proxy = `postgres-${testInfo.parallelIndex}`;
  const port = await freePort();
  api = `http://localhost:${port}`;
  server = spawn(process.execPath, ['src/server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test', PORT: String(port), DATABASE_URL: line,
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      DB_CONNECT_TIMEOUT_MS: String(CONNECT_TIMEOUT), DB_QUERY_TIMEOUT_MS: String(QUERY_TIMEOUT),
      DB_RETRY_DELAY_MS: String(RETRY_DELAY),
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${receiverPort}`, OTEL_BSP_SCHEDULE_DELAY: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => { log += d; });
  server.stderr!.on('data', (d) => { log += d; });
  await expect.poll(async () => (await fetch(`${api}/health`).catch(() => null))?.status, { timeout: 15_000 }).toBe(200);
});

test.afterAll(() => {
  server?.kill();
});

// Every fault off and the line back on, whatever a test did; the server's log
// goes with a failed test.
test.afterEach(async ({}, testInfo) => {
  if (!proxy) return; // beforeAll failed: no line to reset
  for (const { name } of await toxiproxy('GET', '/toxics')) await removeToxic(name);
  await setLine(true);
  if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('resilience server log', { body: log });
  log = '';
});

// A request to this file's server, timed, in a new trace of its own.
async function timed(request: APIRequestContext, method: 'get' | 'post', path: string, options: { headers?: Record<string, string>; data?: unknown } = {}) {
  const { traceId, headers } = newTrace();
  const started = Date.now();
  const res = await request[method](`${api}${path}`, { ...options, headers: { ...options.headers, ...headers } });
  return { res, ms: Date.now() - started, traceId };
}

const retries = (spans: FlatSpan[]) =>
  spans.flatMap((s) => s.events.filter((e) => e.name === 'db.retry').map((e) => e.attributes));

async function expectUnavailable(res: APIResponse) {
  expect(res.status()).toBe(503);
  expect(res.headers()['retry-after']).toBe('2');
  expect(await res.json()).toEqual({ error: 'Database unavailable' });
}

// A write cut after it was sent: maybe saved, so no invitation to send it again.
async function expectMaybeSaved(res: APIResponse) {
  expect(res.status()).toBe(503);
  expect(res.headers()['retry-after']).toBeUndefined();
  expect(await res.json()).toEqual({ error: 'Database unavailable: the change may have been saved. Check before sending it again.' });
}

// Warms the pool: after this, one open connection waits idle in it, so the next
// request reuses it instead of connecting (which a fault would slow down too).
async function warm(request: APIRequestContext, productId: number) {
  expect((await request.get(`${api}/products/${productId}`)).status()).toBe(200);
}

test.describe('Resilience (Toxiproxy)', () => {
  test('RS-01 with nothing wrong on the line, the server behind the proxy answers like the direct one @regression', async ({ request }) => {
    const product = await makeProduct(request, { name: 'Through the proxy' });
    expect((await request.get(`${api}/health/ready`)).status()).toBe(200);
    const res = await request.get(`${api}/products/${product.id}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).name).toBe('Through the proxy');
  });

  test('RS-02 a slow database inside the query timeout is slow, not an error @regression', async ({ request }) => {
    const product = await makeProduct(request);
    await warm(request, product.id);
    await addToxic('slow', 'latency', { latency: 400 });
    const { res, ms } = await timed(request, 'get', `/products/${product.id}`);
    expect(res.status()).toBe(200);
    expect(ms).toBeGreaterThanOrEqual(400);
  });

  test('RS-03 a database slower than the query timeout gets a quick 503, not a hang, and is not tried again @regression', async ({ request }) => {
    const product = await makeProduct(request);
    await warm(request, product.id);
    await addToxic('slow', 'latency', { latency: 5000 });
    const { res, ms, traceId } = await timed(request, 'get', `/products/${product.id}`);
    await expectUnavailable(res);
    // At the query timeout, and well before the answer (5 s) or a second try (2 x 1.5 s).
    expect(ms).toBeGreaterThanOrEqual(QUERY_TIMEOUT);
    expect(ms).toBeLessThan(QUERY_TIMEOUT + 1000);

    const spans = await spansOf(traceId);
    const select = spans.find((s) => s.name === 'SELECT')!;
    expect(select.status.code).toBe(ERROR);
    expect(select.status.message).toBe('database unavailable (timeout): Query read timeout');
    expect(spans.find((s) => s.kind === SERVER)!.status.code).toBe(ERROR);
    expect(retries(spans)).toEqual([]);

    // Once the line is fast again, so is the API: the stuck connection was closed.
    await removeToxic('slow');
    expect((await request.get(`${api}/products/${product.id}`)).status()).toBe(200);
  });

  test('RS-04 a read whose line is cut mid-call is tried once more and succeeds, and the trace shows the retry @regression', async ({ request }) => {
    const product = await makeProduct(request, { name: 'Read twice' });
    await warm(request, product.id);
    // The answer is held 1 s on the line, so the request is surely in flight at 300 ms.
    await addToxic('slow', 'latency', { latency: 1000 });
    const reading = timed(request, 'get', `/products/${product.id}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Cut every line, then put it back as it was before the retry (500 ms later).
    await setLine(false);
    await removeToxic('slow');
    await setLine(true);

    const { res, ms, traceId } = await reading;
    expect(res.status()).toBe(200);
    expect((await res.json()).name).toBe('Read twice');
    expect(ms).toBeGreaterThanOrEqual(300 + RETRY_DELAY);
    const spans = await spansOf(traceId);
    expect(retries(spans)).toEqual([{ 'qa.retry.attempt': 2, 'qa.retry.reason': 'lost' }]);
    // Two SELECT spans: the one cut off, then the retry.
    expect(spans.filter((s) => s.name === 'SELECT').map((s) => s.status.code)).toEqual([ERROR, 0]);
  });

  test('RS-05 a sign-up cut after its INSERT was sent is not sent again: one account, and a 503 that says it may be saved rather than a false "email in use" @regression', async ({ request }) => {
    const email = `resilience.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    // The test's own uncommitted row with the same email makes the API's INSERT
    // wait (Postgres can't tell yet whether the email will be taken).
    const held = await holdUntilBlocked(
      (c) => c.query("INSERT INTO users (name, email, password, role) VALUES ('Holder', $1, 'x', 'user')", [email]),
      () => request.post(`${api}/auth/register`, { data: { name: 'Cut Off', email, password: 'Passw0rd!long' } }),
    );
    // The line resets as soon as Postgres answers: the INSERT is saved, the API never hears.
    await addToxic('cut', 'reset_peer', { timeout: 0 });
    await held.release('ROLLBACK');
    // A blip, not an outage: the line works again before a retry could come, so a
    // retried INSERT would get through (and find the email taken: a 409).
    await held.cutDone();
    await removeToxic('cut');

    // It was saved, so the reply must not say "try again in 2 s" (code review).
    await expectMaybeSaved(await held.response);
    const [{ n }] = await sql('SELECT count(*)::int AS n FROM users WHERE email = $1', [email]);
    expect(n).toBe(1);
  });

  test('RS-06 an order cut while it waits for a row lock is rolled back and not tried again: no order, stock unchanged @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 5 });
    // Signed up on this file's server: each server signs its tokens with its own secret.
    const buyer = await signUp(request, api);
    const { traceId, headers } = newTrace();
    const held = await holdUntilBlocked(
      (c) => c.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [product.id]),
      () => request.post(`${api}/orders`, { headers: { ...buyer.auth, ...headers }, data: { items: [{ product_id: product.id, quantity: 2 }] } }),
    );
    await addToxic('cut', 'reset_peer', { timeout: 0 });
    await held.release('COMMIT');
    await held.cutDone(); // as in RS-05: a retried order would get through
    await removeToxic('cut');

    await expectUnavailable(await held.response);
    expect(await sql('SELECT id FROM orders WHERE user_id = $1', [buyer.id])).toEqual([]);
    const [{ stock }] = await sql('SELECT stock::int FROM products WHERE id = $1', [product.id]);
    expect(stock).toBe(5);

    const spans = await spansOf(traceId);
    expect(retries(spans)).toEqual([]);
    expect(spans.find((s) => s.name === 'db.transaction')!.attributes['qa.transaction.outcome']).toBe('rollback');
  });

  test('RS-07 a line that goes silent gives 503s within the timeouts, /health/ready says so, and the API recovers when it comes back @regression', async ({ request }) => {
    const product = await makeProduct(request);
    await warm(request, product.id);
    // timeout 0: nothing gets through, and the line is never closed.
    await addToxic('silent', 'timeout', { timeout: 0 });
    const { res, ms } = await timed(request, 'get', `/products/${product.id}`);
    await expectUnavailable(res);
    expect(ms).toBeLessThan(QUERY_TIMEOUT + 1000);
    // A new connection can't be made either: two tries at the connect timeout.
    const ready = await timed(request, 'get', '/health/ready');
    await expectUnavailable(ready.res);
    expect(ready.ms).toBeLessThan(2 * CONNECT_TIMEOUT + RETRY_DELAY + QUERY_TIMEOUT + 1000);

    await removeToxic('silent');
    await expect.poll(async () => (await request.get(`${api}/health/ready`)).status(), { timeout: 10_000 }).toBe(200);
    expect((await request.get(`${api}/products/${product.id}`)).status()).toBe(200);
  });

  test('RS-08 a connect that fails is tried once more after a pause, so a short outage costs a wait, not an error @regression', async ({ request }) => {
    const product = await makeProduct(request, { name: 'Connect twice' });
    // Hang up every connection, then ask /health/ready until its first failure is
    // a connect: only then does the pool hold no dead connection the next request
    // could pick up (which would fail as 'lost' instead; code review).
    await setLine(false);
    await expect.poll(async () => {
      const { traceId } = await timed(request, 'get', '/health/ready');
      return retries(await spansOf(traceId))[0]?.['qa.retry.reason'];
    }, { timeout: 15_000 }).toBe('connect');
    const reading = timed(request, 'get', `/products/${product.id}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY / 2));
    await setLine(true); // back before the retry

    const { res, traceId } = await reading;
    expect(res.status()).toBe(200);
    expect((await res.json()).name).toBe('Connect twice');
    expect(retries(await spansOf(traceId))).toEqual([{ 'qa.retry.attempt': 2, 'qa.retry.reason': 'connect' }]);
  });

  test('RS-09 sign-ins during an outage get 503s and do not use up the 5 attempts, so the owner can sign in once it is back @regression', async ({ request }) => {
    const email = `resilience.login.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'Passw0rd!long';
    expect((await request.post(`${api}/auth/register`, { data: { name: 'Owner', email, password } })).status()).toBe(201);
    await setLine(false);
    for (let i = 0; i < LOGIN_ATTEMPTS + 1; i++) {
      await expectUnavailable(await request.post(`${api}/auth/login`, { data: { email, password } }));
    }
    await setLine(true);
    const res = await request.post(`${api}/auth/login`, { data: { email, password } });
    expect(res.status()).toBe(200); // not 429 Too many sign-in attempts
  });
});
