import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ts       = Date.now();
const testUser = { name: 'Auth Tester', email: `auth.${ts}@example.com`, password: 'Pass123!' };

let token;

test.describe('Auth routes', () => {
  test('POST /auth/register creates user and returns token @smoke', async ({ request }) => {
    const res  = await request.post('/auth/register', { data: testUser });
    const body = await res.json();

    expect(res.status()).toBe(201);
    expect(body.user.email).toBe(testUser.email);
    expect(body.user).not.toHaveProperty('password');
    expect(typeof body.token).toBe('string');
    token = body.token;
  });

  test('POST /auth/register duplicate email returns 409 @regression', async ({ request }) => {
    const res  = await request.post('/auth/register', { data: testUser });
    const body = await res.json();

    expect(res.status()).toBe(409);
    expect(body.error).toMatch(/already in use/i);
  });

  test('POST /auth/register missing fields returns 400 @regression', async ({ request }) => {
    const res = await request.post('/auth/register', { data: { email: 'nopass@example.com' } });
    expect(res.status()).toBe(400);
  });

  test('POST /auth/login correct credentials returns token @smoke', async ({ request }) => {
    const res  = await request.post('/auth/login', {
      data: { email: testUser.email, password: testUser.password },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.user.email).toBe(testUser.email);
    expect(body.user).not.toHaveProperty('password');
    expect(typeof body.token).toBe('string');
    token = body.token;
  });

  test('POST /auth/login wrong password returns 401 @regression', async ({ request }) => {
    const res  = await request.post('/auth/login', {
      data: { email: testUser.email, password: 'wrong' },
    });
    const body = await res.json();

    expect(res.status()).toBe(401);
    expect(body.error).toMatch(/invalid credentials/i);
  });

  test('GET /auth/me with valid token returns current user @smoke', async ({ request }) => {
    const res  = await request.get('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.email).toBe(testUser.email);
    expect(body).not.toHaveProperty('password');
  });

  test('GET /auth/me without token returns 401 @regression', async ({ request }) => {
    const res = await request.get('/auth/me');
    expect(res.status()).toBe(401);
  });

  test('GET /auth/me with invalid token returns 401 @regression', async ({ request }) => {
    const res = await request.get('/auth/me', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status()).toBe(401);
  });
});
