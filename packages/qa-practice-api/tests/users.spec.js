import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ts       = Date.now();
const testUser = { name: 'Users Tester', email: `users.${ts}@example.com`, password: 'Pass123!' };

let token;
let userId;

test.describe('Users routes', () => {
  test.beforeAll(async ({ request }) => {
    const res  = await request.post('/auth/register', { data: testUser });
    const body = await res.json();
    token  = body.token;
    userId = body.user.id;
  });

  test('GET /users requires auth @regression', async ({ request }) => {
    const res = await request.get('/users');
    expect(res.status()).toBe(401);
  });

  test('GET /users returns paginated list without passwords @smoke', async ({ request }) => {
    const res  = await request.get('/users', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe('number');
    body.data.forEach(u => expect(u).not.toHaveProperty('password'));
  });

  test('GET /users/:id returns user without password @smoke', async ({ request }) => {
    const res  = await request.get(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.id).toBe(userId);
    expect(body.email).toBe(testUser.email);
    expect(body).not.toHaveProperty('password');
  });

  test('GET /users/:id non-existent ID returns 404 @regression', async ({ request }) => {
    const res  = await request.get('/users/999999', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status()).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  test('PUT /users/:id updates own account @regression', async ({ request }) => {
    const res  = await request.put(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Updated Name' },
    });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.name).toBe('Updated Name');
    expect(body.email).toBe(testUser.email);
  });

  test('DELETE /users/:id removes own account @regression', async ({ request }) => {
    const del = await request.delete(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status()).toBe(204);

    const get = await request.get(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(get.status()).toBe(404);
  });
});
