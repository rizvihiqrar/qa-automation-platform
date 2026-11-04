import { test, expect, type APIRequestContext } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { signUp, signIn, unusedEmail, PASSWORD } from '../design/helpers.ts';
import { startServer, type Started } from '../start-server.ts';

// OWASP Top 10 (2021), A07 Identification and Authentication Failures. Forged and damaged
// tokens, the ways a sign-in can give an account away, and weak passwords. The sign-in limiter
// (A07's guessing defence) is tested in rate-limit.spec.ts and tests/design.
//
// Forging a token needs the signing secret. The suite's own server picks a random one at every
// start, so most cases run on a copy started with a secret the test knows; the secret is only
// for that throwaway copy.

const SECRET = 'owasp-a07-throwaway-secret';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

test.describe('A07 forged and damaged tokens', () => {
  let server: Started;
  let id: number;

  test.beforeAll(async ({ playwright }) => {
    server = await startServer({ JWT_SECRET: SECRET });
    const api = await playwright.request.newContext();
    const res = await api.post(`${server.url}/auth/register`, { data: { name: 'Forge', email: unusedEmail(), password: PASSWORD } });
    id = (await res.json()).user.id;
    await api.dispose();
  });
  test.afterAll(() => server?.stop());

  const me = (request: APIRequestContext, token: string) => request.get(`${server.url}/auth/me`, { headers: bearer(token) });

  test('OW-A07-01 control: a token signed with the right secret and algorithm is accepted, so the refusals below mean something @regression', async ({ request }) => {
    const token = jwt.sign({ id, role: 'user' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    expect((await me(request, token)).status()).toBe(200);
  });

  test('OW-A07-02 an expired token is refused @regression', async ({ request }) => {
    const token = jwt.sign({ id, role: 'user' }, SECRET, { algorithm: 'HS256', expiresIn: -10 });
    const res = await me(request, token);
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toMatch(/invalid or expired/);
  });

  test('OW-A07-03 a token with no signature (algorithm none) is refused, whoever it names @regression', async ({ request }) => {
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id, role: 'admin' })}.`;
    expect((await me(request, unsigned)).status()).toBe(401);
    // The same with the algorithm spelled the other ways it has been accepted by mistake.
    for (const alg of ['None', 'NONE', 'nOnE']) {
      expect((await me(request, `${b64({ alg, typ: 'JWT' })}.${b64({ id, role: 'admin' })}.`)).status(), alg).toBe(401);
    }
  });

  test('OW-A07-04 a token signed with the right secret but another algorithm is refused: the server accepts HS256 only @regression', async ({ request }) => {
    for (const algorithm of ['HS384', 'HS512'] as const) {
      const token = jwt.sign({ id, role: 'user' }, SECRET, { algorithm, expiresIn: '1h' });
      expect((await me(request, token)).status(), algorithm).toBe(401);
    }
  });

  test('OW-A07-05 a token signed with any other secret is refused, including the secrets people guess first @regression', async ({ request }) => {
    for (const secret of ['secret', 'password', 'changeme', 'jwt_secret', 'owasp-a07-throwaway-secret ']) {
      const token = jwt.sign({ id, role: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
      expect((await me(request, token)).status(), `secret "${secret}"`).toBe(401);
    }
  });

  test('OW-A07-06 changing a token\'s payload without re-signing it (role user to admin) breaks it @regression', async ({ request }) => {
    const token = jwt.sign({ id, role: 'user' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    const [header, , signature] = token.split('.');
    const forged = `${header}.${b64({ id, role: 'admin', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.${signature}`;
    expect((await request.get(`${server.url}/users`, { headers: bearer(forged) })).status()).toBe(401);
  });

  test('OW-A07-07 a correctly signed token that says admin does not make a customer an admin: the role comes from the account @regression', async ({ request }) => {
    const token = jwt.sign({ id, role: 'admin' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    expect((await me(request, token)).status(), 'the token is valid').toBe(200);
    expect((await request.get(`${server.url}/users`, { headers: bearer(token) })).status(), 'but the account is a customer').toBe(403);
  });

  test('OW-A07-08 a correctly signed token for an account that does not exist is refused @regression', async ({ request }) => {
    const token = jwt.sign({ id: 987654321, role: 'user' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    expect((await me(request, token)).status()).toBe(401);
  });
});

test.describe('A07 the Authorization header', () => {
  test('OW-A07-09 anything but Bearer and a valid token is a 401: other schemes, a missing token, extra parts @regression', async ({ request }) => {
    const account = await signUp(request);
    const token = account.auth.Authorization.slice(7);
    for (const header of ['', 'Bearer', 'Bearer ', `bearer ${token}`, `Basic ${token}`, `Token ${token}`, token, `Bearer ${token}x`, 'Bearer null', 'Bearer undefined']) {
      const res = await request.get('/auth/me', { headers: { Authorization: header } });
      expect(res.status(), `"${header.slice(0, 30)}"`).toBe(401);
    }
    expect((await request.get('/auth/me', { headers: account.auth })).status(), 'the real header works').toBe(200);
  });

  test('OW-A07-10 a token in the query string or a cookie does not sign anyone in @regression', async ({ request }) => {
    const account = await signUp(request);
    const token = account.auth.Authorization.slice(7);
    expect((await request.get(`/auth/me?token=${token}&access_token=${token}`)).status()).toBe(401);
    expect((await request.get('/auth/me', { headers: { Cookie: `token=${token}; jwt=${token}` } })).status()).toBe(401);
  });
});

test.describe('A07 sign-in answers', () => {
  test('OW-A07-11 an unknown email and a wrong password get the same answer, so sign-in does not tell which accounts exist @regression', async ({ request }) => {
    const account = await signUp(request);
    const wrongPassword = await signIn(request, account.email, 'not-the-password');
    const unknownEmail = await signIn(request, unusedEmail(), 'not-the-password');
    expect(unknownEmail.status()).toBe(wrongPassword.status());
    expect(await unknownEmail.json()).toEqual(await wrongPassword.json());
  });

  test('OW-A07-12 a failed sign-in does not repeat the password it was given @regression', async ({ request }) => {
    const secret = `Distinct-${Date.now()}-Marker!`;
    const res = await signIn(request, unusedEmail(), secret);
    expect(await res.text()).not.toContain(secret);
  });

  test('OW-A07-13 a successful sign-in does not put the password in any response header @regression', async ({ request }) => {
    const account = await signUp(request);
    const res = await signIn(request, account.email, PASSWORD);
    expect(JSON.stringify(res.headers())).not.toContain(PASSWORD);
  });
});

test.describe('A07 default accounts and weak passwords', () => {
  test('OW-A07-14 a server started without ADMIN_EMAIL and ADMIN_PASSWORD has no admin: the usual default logins all fail @regression', async ({ request }) => {
    const server = await startServer({ ADMIN_EMAIL: '', ADMIN_PASSWORD: '' });
    try {
      const pairs = [['admin', 'admin'], ['admin@example.com', 'admin'], ['admin@example.com', 'password'], ['root', 'root'], ['administrator', 'admin123']];
      for (const [email, password] of pairs) {
        const res = await request.post(`${server.url}/auth/login`, { data: { email, password } });
        expect(res.status(), `${email} / ${password}`).toBe(401);
      }
    } finally {
      await server.stop();
    }
  });

  // KNOWN GAP, not a pass: sign-up takes any password, so a one-character password is accepted.
  // test.fail() makes this test expected to fail: it keeps the run green while the gap is open,
  // and fails the run the day a password rule is added, which is the signal to delete the line.
  test('OW-A07-15 a one-character password is refused at sign-up (known gap: it is accepted) @regression', async ({ request }) => {
    test.fail(true, 'known gap: no password rule at sign-up (README, Security)');
    const res = await request.post('/auth/register', { data: { name: 'Weak', email: unusedEmail(), password: 'a' } });
    expect(res.status()).toBe(400);
  });
});
