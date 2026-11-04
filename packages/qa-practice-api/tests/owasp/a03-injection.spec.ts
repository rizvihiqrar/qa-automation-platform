import { test, expect } from '@playwright/test';
import { signUp, makeProduct, admin, signIn, uniqueCategory, PASSWORD } from '../design/helpers.ts';

// OWASP Top 10 (2021), A03 Injection. Text built to change what a query means is sent
// everywhere the API takes text: query strings, sign-in, sign-up, names and ids in URLs. The
// safe outcome is always the same: the text is data, so it matches nothing, is stored as typed,
// or is refused. It never widens a result, breaks a request (a 500) or runs. Run on Postgres
// (npm run test:postgres) these reach real SQL; in memory they check the same rules.

const INJECTIONS = [
  "' OR '1'='1",
  "'; DROP TABLE products; --",
  "' UNION SELECT id, email, password, 0, 0 FROM users --",
  '" OR ""="',
  '1; SELECT pg_sleep(10)',
  "\\' OR 1=1 --",
];

test.describe('A03 Injection', () => {
  test('OW-A03-01 injection text in the category filter matches nothing instead of everything, and does not run @regression', async ({ request }) => {
    const category = uniqueCategory();
    await makeProduct(request, { category });
    const honest = await (await request.get(`/products?category=${encodeURIComponent(category)}`)).json();
    expect(honest.total, 'the real category finds its product').toBe(1);
    for (const text of INJECTIONS) {
      const started = Date.now();
      const res = await request.get(`/products?category=${encodeURIComponent(text)}`);
      expect(res.status(), text).toBe(200);
      expect((await res.json()).total, `${text} matches no category`).toBe(0);
      expect(Date.now() - started, `${text} ran something slow`).toBeLessThan(5000);
    }
  });

  test('OW-A03-02 injection text as the email or the password of a sign-in is a plain 401, never a sign-in and never a 500 @regression', async ({ request }) => {
    const account = await signUp(request);
    for (const text of INJECTIONS) {
      const asEmail = await signIn(request, text, PASSWORD);
      expect(asEmail.status(), `email ${text}`).toBe(401);
    }
    // Four wrong passwords for one account: the sixth attempt in a row would meet the limiter (429).
    for (const text of INJECTIONS.slice(0, 4)) {
      expect((await signIn(request, account.email, text)).status(), `password ${text}`).toBe(401);
    }
    expect((await signIn(request, account.email, PASSWORD)).status(), 'the real password still works').toBe(200);
  });

  test('OW-A03-03 a name that is a SQL statement is stored as typed, and the users table is untouched @regression', async ({ request }) => {
    const name = "Robert'); DROP TABLE users; --";
    const email = `owasp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
    const res = await request.post('/auth/register', { data: { name, email, password: PASSWORD } });
    expect(res.status()).toBe(201);
    const { token } = await res.json();
    const me = await (await request.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(me.name).toBe(name);
    const next = await signUp(request); // the table is still there
    expect(next.id).toBeGreaterThan(me.id);
    const list = await request.get('/users?limit=1', { headers: admin().auth });
    expect(list.status()).toBe(200);
  });

  test('OW-A03-04 a product name that is a SQL statement is stored and returned as typed, and the catalogue still lists @regression', async ({ request }) => {
    const name = "x'); DELETE FROM products; --";
    const category = uniqueCategory();
    const product = await makeProduct(request, { name, category });
    expect((await (await request.get(`/products/${product.id}`)).json()).name).toBe(name);
    expect((await (await request.get(`/products?category=${category}`)).json()).total).toBe(1);
  });

  test('OW-A03-05 text after a number in a URL id is never run: the one product comes back, or a 404, never a list or a 500 @regression', async ({ request }) => {
    const product = await makeProduct(request);
    // The id is read up to the first character that is not a digit (parseInt), so the rest is
    // ignored, not executed.
    for (const tail of [' OR 1=1', ';DROP TABLE products', "' OR '1'='1", '%20UNION%20SELECT%201']) {
      const res = await request.get(`/products/${product.id}${tail}`);
      expect(res.status(), tail).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body), tail).toBe(false);
      expect(body.id, tail).toBe(product.id);
    }
    // No number at the start: nothing to look up.
    for (const id of ["' OR 1=1 --", 'OR%201=1', '-1', '0', '99999999999999999999']) {
      expect((await request.get(`/products/${id}`)).status(), id).toBe(404);
    }
  });

  test('OW-A03-06 an object or a list where text is expected is a 400 on sign-in and is ignored in a filter, not a 500 @regression', async ({ request }) => {
    const asObject = await request.post('/auth/login', { data: { email: { $ne: null }, password: { $ne: null } } });
    expect(asObject.status()).toBe(400);
    const asList = await request.post('/auth/login', { data: { email: ['a@example.com'], password: [PASSWORD] } });
    expect(asList.status()).toBe(400);
    for (const query of ['category[$ne]=x', 'category[]=a&category[]=b', 'category[a][b]=c']) {
      expect((await request.get(`/products?${query}&limit=1`)).status(), query).toBe(200);
    }
  });

  test('OW-A03-07 __proto__ and constructor in a body change nothing for the accounts made after it @regression', async ({ request }) => {
    const email = `owasp.proto.${Date.now()}@example.com`;
    const res = await request.post('/auth/register', {
      data: { name: 'Proto', email, password: PASSWORD, __proto__: { role: 'admin' }, constructor: { prototype: { role: 'admin' } } },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).user.role).toBe('user');
    const later = await signUp(request);
    const list = await request.get('/users', { headers: later.auth });
    expect(list.status(), 'a later account is not an admin').toBe(403);
  });
});
