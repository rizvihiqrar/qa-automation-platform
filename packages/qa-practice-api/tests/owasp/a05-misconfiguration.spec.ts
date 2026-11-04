import { test, expect } from '@playwright/test';
import { signUp, unusedEmail, PASSWORD } from '../design/helpers.ts';

// OWASP Top 10 (2021), A05 Security Misconfiguration: what a stranger can learn from how the
// server is set up. Headers, cross-origin rules, routes that should not exist, error bodies, and
// what a request too big for the server does. (The nosniff and cross-origin-resource-policy headers
// are in headers.spec.ts; default logins are under A07.)

// Anything that shows how or where the server runs: a stack frame, a file path, a module folder.
const LEAK = /\bat\s+\S+\s+\(|node_modules|[A-Za-z]:\\|\/home\/|\/usr\/|\/app\/|\.ts:\d+|\.js:\d+|ECONN|SQLSTATE|pg_/;

test.describe('A05 what the server says about itself', () => {
  test('OW-A05-01 no response names the framework or the server: no X-Powered-By, no Server header @regression', async ({ request }) => {
    for (const path of ['/health', '/products', '/nowhere', '/auth/me']) {
      const headers = (await request.get(path)).headers();
      expect(headers['x-powered-by'], path).toBeUndefined();
      expect(headers['server'], path).toBeUndefined();
    }
  });

  test('OW-A05-02 a page on another site is not let in: no Access-Control-Allow-Origin on a simple request or a preflight @regression', async ({ request }) => {
    const origin = 'https://evil.example';
    const simple = await request.get('/products', { headers: { Origin: origin } });
    expect(simple.headers()['access-control-allow-origin']).toBeUndefined();
    const preflight = await request.fetch('/orders', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(preflight.headers()['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers()['access-control-allow-credentials']).toBeUndefined();
    expect(preflight.headers()['access-control-allow-methods']).toBeUndefined();
  });

  test('OW-A05-03 the places an exposed server often leaves open are not there: debug, admin, metrics, docs, dotfiles, source control @regression', async ({ request }) => {
    const paths = ['/debug', '/admin', '/metrics', '/actuator/health', '/swagger.json', '/api-docs', '/graphql', '/.env', '/.git/config', '/package.json', '/server-status', '/console', '/src/server.ts'];
    for (const path of paths) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.json(), path).toEqual({ error: `Route GET ${path} not found` });
    }
  });

  test('OW-A05-04 methods the API does not use are a 404 in the same JSON shape, not an echo of the request or an HTML page @regression', async ({ request }) => {
    for (const method of ['DELETE', 'PUT', 'PATCH', 'OPTIONS']) {
      const res = await request.fetch('/health', { method });
      expect(res.status(), method).toBe(404);
      expect(res.headers()['content-type'], method).toContain('application/json');
    }
  });
});

test.describe('A05 error bodies', () => {
  test('OW-A05-05 every kind of error answers with just an error message: no stack, no file path, no driver text @regression', async ({ request }) => {
    const me = await signUp(request);
    const errors = [
      await request.post('/auth/login', { data: Buffer.from('{"email":') }), // 400, bad JSON
      await request.post('/auth/login', { data: { email: 1, password: [] } }), // 400, wrong types
      await request.get('/auth/me'), // 401
      await request.get('/users', { headers: me.auth }), // 403
      await request.get('/nowhere'), // 404
      await request.get('/products/abc'), // 404
      await request.post('/orders', { headers: me.auth, data: { items: [{ product_id: 'x', quantity: -1 }] } }), // 400/404
      await request.post('/auth/register', { data: { name: 'Dup', email: unusedEmail(), password: PASSWORD } }).then(async (first) => {
        expect(first.status()).toBe(201);
        return request.post('/auth/register', { data: { name: 'Dup', email: (await first.json()).user.email, password: PASSWORD } }); // 409
      }),
    ];
    for (const res of errors) {
      expect(res.status()).toBeGreaterThanOrEqual(400);
      expect(res.status()).toBeLessThan(500);
      const body = await res.json();
      expect(Object.keys(body), `${res.status()} ${res.url()}`).toEqual(['error']);
      expect(JSON.stringify(body), `${res.status()} ${res.url()}`).not.toMatch(LEAK);
    }
  });

  test('OW-A05-06 a body over the 100 kb limit is a 413 that says so, not a 500 @regression', async ({ request }) => {
    const res = await request.post('/auth/register', { data: { name: 'a'.repeat(200_000), email: unusedEmail(), password: PASSWORD } });
    expect(res.status()).toBe(413);
    expect(await res.json()).toEqual({ error: 'Request body is too large' });
  });

  test('OW-A05-07 a body just under the limit is read, and an empty body or a body of the wrong type is a 400 @regression', async ({ request }) => {
    const nearly = await request.post('/auth/login', { data: { email: 'a'.repeat(90_000), password: 'x' } });
    expect(nearly.status(), 'about 90 kb is read, then refused as wrong credentials').toBe(401);
    expect((await request.post('/auth/login', { data: '' })).status()).toBe(400);
    expect((await request.post('/auth/login', { headers: { 'Content-Type': 'text/plain' }, data: 'email=a&password=b' })).status()).toBe(400);
    expect((await request.post('/auth/login', { headers: { 'Content-Type': 'application/xml' }, data: '<a/>' })).status()).toBe(400);
  });

  test('OW-A05-08 a very long URL or query string gets an answer, not a hang or a crash, and the server keeps serving @regression', async ({ request }) => {
    const long = await request.get(`/products?category=${'a'.repeat(7000)}`);
    expect([200, 414, 431]).toContain(long.status());
    expect((await request.get('/health')).status()).toBe(200);
  });
});
