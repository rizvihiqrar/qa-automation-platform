// Access control for the /discounts endpoints (DC-R10): every endpoint tried with
// no token, a bad token and a customer's token; unknown codes as the admin.
import { test, expect } from '@playwright/test';
import { signUp, admin, makeCode } from './helpers.ts';

type Method = 'get' | 'post' | 'patch';
type Caller = 'no token' | 'a bad token' | 'a customer';

const NEW_CODE = { code: 'NOT-ALLOWED', type: 'percent', value: 10 };
const rows: [id: string, rule: string, method: Method, path: string, caller: Caller, status: number][] = [
  ['DC-AC-01', 'DC-R10', 'get', '/discounts', 'no token', 401],
  ['DC-AC-02', 'DC-R10', 'get', '/discounts', 'a bad token', 401],
  ['DC-AC-03', 'DC-R10', 'get', '/discounts', 'a customer', 403],
  ['DC-AC-04', 'DC-R10', 'get', '/discounts/{code}', 'no token', 401],
  ['DC-AC-05', 'DC-R10', 'get', '/discounts/{code}', 'a bad token', 401],
  ['DC-AC-06', 'DC-R10', 'get', '/discounts/{code}', 'a customer', 403],
  ['DC-AC-07', 'DC-R10', 'post', '/discounts', 'no token', 401],
  ['DC-AC-08', 'DC-R10', 'post', '/discounts', 'a bad token', 401],
  ['DC-AC-09', 'DC-R10', 'post', '/discounts', 'a customer', 403],
  ['DC-AC-10', 'DC-R10', 'patch', '/discounts/{code}', 'no token', 401],
  ['DC-AC-11', 'DC-R10', 'patch', '/discounts/{code}', 'a bad token', 401],
  ['DC-AC-12', 'DC-R10', 'patch', '/discounts/{code}', 'a customer', 403],
];

for (const [id, rule, method, template, caller, status] of rows) {
  test(`${id} [${rule}] ${method.toUpperCase()} ${template} with ${caller} returns ${status} @regression`, async ({ request }) => {
    const code = await makeCode(request);
    const headers = caller === 'no token' ? {}
      : caller === 'a bad token' ? { Authorization: 'Bearer not-a-token' }
      : (await signUp(request)).auth;
    const data = method === 'post' ? NEW_CODE : method === 'patch' ? { active: false } : undefined;
    const res = await request[method](template.replace('{code}', code), { headers, ...(data ? { data } : {}) });
    expect(res.status()).toBe(status);
    // Nothing a refused caller sent got through.
    expect((await (await request.get(`/discounts/${code}`, { headers: admin().auth })).json()).active).toBe(true);
    expect((await request.get(`/discounts/${NEW_CODE.code}`, { headers: admin().auth })).status()).toBe(404);
  });
}

test('DC-AC-13 [DC-R10] GET of an unknown code as the admin returns 404 @regression', async ({ request }) => {
  expect((await request.get('/discounts/NO-SUCH-CODE-13', { headers: admin().auth })).status()).toBe(404);
});

test('DC-AC-14 [DC-R10] PATCH of an unknown code as the admin returns 404 @regression', async ({ request }) => {
  const res = await request.patch('/discounts/NO-SUCH-CODE-14', { headers: admin().auth, data: { active: false } });
  expect(res.status()).toBe(404);
});
