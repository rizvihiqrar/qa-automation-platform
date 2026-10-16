import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { runScenario, untestedOperations, formatResults } from '../src/runner.js';

const spec = JSON.parse(fs.readFileSync(new URL('../spec/qa-practice-api.openapi.json', import.meta.url), 'utf8'));
const created = '2026-10-16T08:00:00.000Z';

// A tiny fake of the API with switches that introduce one kind of drift each.
const drift = { leakPassword: false, priceAsString: false, dropCategory: false, crashOnMissing: false, badStatus: false };
let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/auth/login') {
        const u = { id: 1, name: 'A', email: 'a@example.com', role: drift.badStatus ? 'superuser' : 'user', created_at: created };
        if (drift.leakPassword) u.password = '$2a$10$hash';
        return send(200, { user: u, token: 'tok' });
      }
      if (req.method === 'GET' && req.url === '/products/1') {
        const p = { id: 1, name: 'Backpack', category: 'bags', price: drift.priceAsString ? '29.99' : 29.99, stock: 3, created_at: created };
        if (drift.dropCategory) delete p.category;
        return send(200, p);
      }
      if (req.method === 'GET' && req.url === '/products/404') {
        return drift.crashOnMissing ? send(500, { error: 'Internal error' }) : send(404, { error: 'Product 404 not found' });
      }
      return send(404, { error: 'no route' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const steps = [
  { name: 'log in', method: 'POST', path: '/auth/login', body: { email: 'a@example.com', password: 'p' }, expect: 200, save: (b) => ({ token: b.token, productId: 1 }) },
  { name: 'get product', method: 'GET', path: '/products/{productId}', auth: true, expect: 200 },
  { name: 'missing product', method: 'GET', path: '/products/404', expect: 404 },
];
const run = () => runScenario({ baseUrl, spec, steps });
const allKinds = (results) => results.flatMap((r) => r.issues.map((i) => `${r.name}:${i.kind}`));
const reset = () => Object.keys(drift).forEach((k) => { drift[k] = false; });

test('a matching API has no drift', async () => {
  reset();
  const results = await run();
  assert.deepEqual(allKinds(results), []);
  assert.equal(results[1].path, '/products/1'); // saved variable filled in
});

test('each kind of drift is caught at the right step', async () => {
  /** @type {Array<[keyof typeof drift, string[]]>} */
  const cases = [
    ['leakPassword', ['log in:extra']],
    ['badStatus', ['log in:enum']],
    ['priceAsString', ['get product:type']],
    ['dropCategory', ['get product:missing']],
    ['crashOnMissing', ['missing product:unexpected-status', 'missing product:undocumented-status']],
  ];
  for (const [toggle, expected] of cases) {
    reset();
    drift[toggle] = true;
    assert.deepEqual(allKinds(await run()), expected, toggle);
  }
  reset();
});

test('untestedOperations lists documented operations the scenario never called', async () => {
  reset();
  const untested = untestedOperations(spec, await run()).map((u) => `${u.method} ${u.template}`);
  assert.ok(untested.includes('GET /health'));
  assert.ok(!untested.includes('GET /products/{id}'));
  assert.ok(!untested.includes('POST /auth/login'));
});

test('formatResults summarises passes and drift', async () => {
  reset();
  drift.leakPassword = true;
  const results = await run();
  const text = formatResults(results, []);
  reset();
  assert.match(text, /^DRIFT POST {3}\/auth\/login/m);
  assert.match(text, /extra: \$\.user\.password field "password" is not in the spec/);
  assert.match(text, /2\/3 responses match the spec, 1 drifted/);
});

test('a step that uses a variable nobody saved fails clearly', async () => {
  await assert.rejects(runScenario({ baseUrl, spec, steps: [{ name: 'x', method: 'GET', path: '/orders/{orderId}' }] }), /never saved/);
});
