import { test, expect, type APIRequestContext } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword } from '../../src/security/password.ts';
import { signUp, admin, unusedEmail, PASSWORD } from '../design/helpers.ts';
import { startServer } from '../start-server.ts';

// OWASP Top 10 (2021), A02 Cryptographic Failures: how passwords are kept and what a token
// holds. Data in transit (HTTPS) is not covered: the API speaks plain HTTP, and certificate
// tests are a separate idea. The sign-in limiter and token checks are under A07.

// Every value in a JSON document, at any depth, with the key it sits under.
function* walk(value: unknown, key = ''): Generator<[string, unknown]> {
  yield [key, value];
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* walk(v, k);
  }
}

async function expectNoSecrets(label: string, res: Awaited<ReturnType<APIRequestContext['get']>>, secrets: string[]) {
  const text = await res.text();
  for (const [key, value] of walk(JSON.parse(text))) {
    expect(key.toLowerCase(), `${label}: a field named ${key}`).not.toMatch(/pass(word)?|hash|secret/);
    if (typeof value === 'string') expect(value, `${label}: a value under ${key}`).not.toMatch(/^scrypt\$/);
  }
  for (const secret of secrets) expect(text, `${label} repeats a secret`).not.toContain(secret);
}

test.describe('A02 passwords in responses', () => {
  test('OW-A02-01 no response about an account carries a password, a hash or a field named like one: sign-up, sign-in, me, read, list, update @regression', async ({ request }) => {
    const email = unusedEmail();
    const register = await request.post('/auth/register', { data: { name: 'Secrets', email, password: PASSWORD } });
    const { user, token } = await register.json();
    const auth = { Authorization: `Bearer ${token}` };
    await expectNoSecrets('sign-up', register, [PASSWORD]);
    await expectNoSecrets('sign-in', await request.post('/auth/login', { data: { email, password: PASSWORD } }), [PASSWORD]);
    await expectNoSecrets('me', await request.get('/auth/me', { headers: auth }), [PASSWORD]);
    await expectNoSecrets('read', await request.get(`/users/${user.id}`, { headers: auth }), [PASSWORD]);
    await expectNoSecrets('update', await request.put(`/users/${user.id}`, { headers: auth, data: { name: 'Secrets 2' } }), [PASSWORD]);
    await expectNoSecrets('admin list', await request.get('/users?limit=50', { headers: admin().auth }), [PASSWORD]);
  });

  test('OW-A02-02 the order list shows nothing about the buyer but an id: no email, no hash @regression', async ({ request }) => {
    const buyer = await signUp(request);
    const res = await request.get('/orders', { headers: buyer.auth });
    const text = await res.text();
    expect(text).not.toContain(buyer.email);
    expect(text).not.toMatch(/scrypt\$/);
  });
});

test.describe('A02 how a password is stored', () => {
  test('OW-A02-03 a hash is scrypt with a 16-byte salt and a 64-byte key, and does not contain the password @regression', async () => {
    const stored = await hashPassword('Plain-text-1!');
    const [scheme, salt, key] = stored.split('$');
    expect(scheme).toBe('scrypt');
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toMatch(/^[0-9a-f]{128}$/);
    expect(stored).not.toContain('Plain-text-1!');
  });

  test('OW-A02-04 the same password hashed twice gives two different hashes (a fresh salt each time), and both verify @regression', async () => {
    const [a, b] = await Promise.all([hashPassword('Same-1!'), hashPassword('Same-1!')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('Same-1!', a)).toBe(true);
    expect(await verifyPassword('Same-1!', b)).toBe(true);
  });

  test('OW-A02-05 a wrong password, a changed hash and a stored value in the wrong shape all fail to verify @regression', async () => {
    const stored = await hashPassword('Right-1!');
    expect(await verifyPassword('Wrong-1!', stored)).toBe(false);
    expect(await verifyPassword('right-1!', stored), 'case matters').toBe(false);
    const flipped = stored.slice(0, -1) + (stored.endsWith('0') ? '1' : '0');
    expect(await verifyPassword('Right-1!', flipped), 'one digit of the key changed').toBe(false);
    for (const odd of ['', 'Right-1!', 'scrypt', 'scrypt$', 'scrypt$00$', 'bcrypt$00$00', '$$']) {
      expect(await verifyPassword('Right-1!', odd), `"${odd}"`).toBe(false);
    }
  });

  test('OW-A02-06 a very long password and one with non-Latin characters hash and verify (no cut-off at 72 bytes, no encoding surprise) @regression', async () => {
    const long = 'a'.repeat(200);
    const stored = await hashPassword(long);
    expect(await verifyPassword(long, stored)).toBe(true);
    expect(await verifyPassword(long.slice(0, 72), stored), 'only the first 72 bytes').toBe(false);
    const unicode = 'пароль-密码-🔑';
    expect(await verifyPassword(unicode, await hashPassword(unicode))).toBe(true);
  });
});

test.describe('A02 what a token holds', () => {
  test('OW-A02-07 a token holds an id and a role and nothing else of the account, and lasts one hour @regression', async ({ request }) => {
    const me = await signUp(request);
    const decoded = jwt.decode(me.auth.Authorization.slice(7)) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'id', 'role']);
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(3600);
  });

  test('OW-A02-08 two servers started without JWT_SECRET sign with different secrets: a token from one is refused by the other @regression', async ({ request }) => {
    const [one, two] = await Promise.all([startServer(), startServer()]);
    try {
      const made = await request.post(`${one.url}/auth/register`, { data: { name: 'Portable', email: unusedEmail(), password: PASSWORD } });
      const { token } = await made.json();
      expect((await request.get(`${one.url}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status(), 'its own server').toBe(200);
      expect((await request.get(`${two.url}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status(), 'the other server').toBe(401);
    } finally {
      await one.stop();
      await two.stop();
    }
  });

  test('OW-A02-09 no setting means no fixed secret: a token signed with a secret written in this repository is refused @regression', async ({ request }) => {
    // The fallback used to be a fixed string published in the repository (README, Environment Variables).
    const server = await startServer();
    try {
      for (const secret of ['your-secret-key', 'secret', 'dev-secret', 'qa-practice-secret', 'changeme']) {
        const forged = jwt.sign({ id: 1, role: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
        expect((await request.get(`${server.url}/users`, { headers: { Authorization: `Bearer ${forged}` } })).status(), secret).toBe(401);
      }
    } finally {
      await server.stop();
    }
  });
});
