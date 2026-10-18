// Equivalence partitioning on the discount code fields: one value from each class
// of input the spec names (right type, wrong type, wrong format), on create and
// on change, plus what a placed order keeps.
import { test, expect } from '@playwright/test';
import {
  signUp, admin, makeProduct, uniqueCode, createCode, makeCode, getCode, patchCode, order,
} from './helpers.ts';

const FIELDS = ['code', 'type', 'value', 'expires_at', 'max_uses', 'min_subtotal', 'active', 'uses', 'created_at'];

test.describe('creating a code', () => {
  const percent = (fields: Record<string, unknown>) => ({ code: uniqueCode(), type: 'percent', value: 10, ...fields });
  const cases: [id: string, rule: string, label: string, fields: Record<string, unknown>, status: number][] = [
    ['DC-EP-01', 'DC-R01', 'code with an underscore', percent({ code: `AB_${uniqueCode(6)}` }), 400],
    ['DC-EP-02', 'DC-R01', 'code with a space inside', percent({ code: `AB ${uniqueCode(6)}` }), 400],
    ['DC-EP-03', 'DC-R01', 'code with a letter outside A-Z', percent({ code: `ÄB${uniqueCode(6)}` }), 400],
    ['DC-EP-04', 'DC-R01', 'code sent as a number', percent({ code: 123456 }), 400],
    ['DC-EP-05', 'DC-R03', 'type in upper case', percent({ type: 'PERCENT' }), 400],
    ['DC-EP-06', 'DC-R03', 'type left out', { code: uniqueCode(), value: 10 }, 400],
    ['DC-EP-07', 'DC-R04', 'value sent as text', percent({ value: '10' }), 400],
    ['DC-EP-08', 'DC-R04', 'percent value 12.5', percent({ value: 12.5 }), 400],
    ['DC-EP-09', 'DC-R04', 'fixed value sent as text', { code: uniqueCode(), type: 'fixed', value: '5.00' }, 400],
    ['DC-EP-10', 'DC-R05', 'expires_at null', percent({ expires_at: null }), 201],
    ['DC-EP-11', 'DC-R05', 'expires_at with an offset', percent({ expires_at: '2027-12-31T23:59:59+05:00' }), 201],
    ['DC-EP-12', 'DC-R05', 'expires_at without a time zone', percent({ expires_at: '2027-12-31T23:59:59' }), 400],
    ['DC-EP-13', 'DC-R05', 'expires_at as a date only', percent({ expires_at: '2027-12-31' }), 400],
    ['DC-EP-14', 'DC-R05', 'expires_at as a number', percent({ expires_at: 1830297599000 }), 400],
    ['DC-EP-15', 'DC-R06', 'max_uses 1.5', percent({ max_uses: 1.5 }), 400],
    ['DC-EP-16', 'DC-R06', 'max_uses sent as text', percent({ max_uses: '5' }), 400],
    ['DC-EP-17', 'DC-R07', 'min_subtotal sent as text', percent({ min_subtotal: '50' }), 400],
    ['DC-EP-18', 'DC-R08', 'active sent as text', percent({ active: 'true' }), 400],
    ['DC-EP-19', 'DC-R08', 'active false', percent({ active: false }), 201],
  ];
  for (const [id, rule, label, fields, status] of cases) {
    test(`${id} [${rule}] ${label} returns ${status} @regression`, async ({ request }) => {
      const res = await createCode(request, fields);
      expect(res.status(), await res.text()).toBe(status);
    });
  }

  test('DC-EP-20 [DC-R01] a lower-case code is stored and returned in upper case @regression', async ({ request }) => {
    const code = uniqueCode().toLowerCase();
    const res = await createCode(request, { code, type: 'percent', value: 10 });
    expect(res.status()).toBe(201);
    expect((await res.json()).code).toBe(code.toUpperCase());
  });

  test('DC-EP-21 [DC-R02] creating a code that exists in another case, or inside spaces, is a 409 @regression', async ({ request }) => {
    const code = await makeCode(request);
    for (const again of [code.toLowerCase(), `  ${code}  `]) {
      expect((await createCode(request, { code: again, type: 'fixed', value: 5 })).status()).toBe(409);
    }
    expect((await getCode(request, code)).type).toBe('percent');
  });

  test('DC-EP-22 [DC-R09] a new code has exactly the spec\'s fields, with the defaults @regression', async ({ request }) => {
    const res = await createCode(request, { code: uniqueCode(), type: 'fixed', value: 5 });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([...FIELDS].sort());
    expect(body).toMatchObject({ expires_at: null, max_uses: null, min_subtotal: 0, active: true, uses: 0 });
  });

  test('DC-EP-23 [DC-R09] the list and a lookup in lower case both show the code @regression', async ({ request }) => {
    const code = await makeCode(request);
    const list = await (await request.get('/discounts', { headers: admin().auth })).json();
    expect(list.find((d: { code: string }) => d.code === code)).toBeTruthy();
    const one = await request.get(`/discounts/${code.toLowerCase()}`, { headers: admin().auth });
    expect(one.status()).toBe(200);
    expect(Object.keys(await one.json()).sort()).toEqual([...FIELDS].sort());
  });
});

test.describe('changing a code (DC-R11)', () => {
  const cases: [id: string, rule: string, label: string, body: unknown, status: number][] = [
    ['DC-EP-24', 'DC-R11', 'the code itself', { code: 'OTHER' }, 400],
    ['DC-EP-25', 'DC-R11', 'the value', { value: 50 }, 400],
    ['DC-EP-26', 'DC-R11', 'active with another field', { active: false, min_subtotal: 0 }, 400],
    ['DC-EP-27', 'DC-R11', 'a list instead of an object', [], 400],
    ['DC-EP-28', 'DC-R11', 'max_uses 0', { max_uses: 0 }, 400],
    ['DC-EP-29', 'DC-R05', 'expires_at a minute ago', { expires_at: new Date(Date.now() - 60_000).toISOString() }, 400],
    ['DC-EP-30', 'DC-R05', 'expires_at 31 April', { expires_at: '2027-04-31T12:00:00Z' }, 400],
  ];
  for (const [id, rule, label, body, status] of cases) {
    test(`${id} [${rule}] PATCH with ${label} returns ${status} and changes nothing @regression`, async ({ request }) => {
      const code = await makeCode(request);
      const before = await getCode(request, code);
      expect((await patchCode(request, code, body)).status()).toBe(status);
      expect(await getCode(request, code)).toEqual(before);
    });
  }

  test('DC-EP-31 [DC-R11] PATCH can clear max_uses and expires_at with null @regression', async ({ request }) => {
    const code = await makeCode(request, { max_uses: 3, expires_at: '2027-12-31T23:59:59Z' });
    const res = await patchCode(request, code, { max_uses: null, expires_at: null });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ max_uses: null, expires_at: null });
  });

  test('DC-EP-32 [DC-R11] max_uses below the uses counted is a 409 and nothing changes; equal is allowed @regression', async ({ request }) => {
    const p = await makeProduct(request, { stock: 10 });
    const code = await makeCode(request, { max_uses: 5 });
    for (let i = 0; i < 2; i++) expect((await order(request, await signUp(request), p.id, 1, code)).status()).toBe(201);
    expect((await patchCode(request, code, { active: false, max_uses: 1 })).status()).toBe(409);
    expect(await getCode(request, code)).toMatchObject({ active: true, max_uses: 5, uses: 2 });
    expect((await patchCode(request, code, { max_uses: 2 })).status()).toBe(200);
  });

  test('DC-EP-33 [DC-R11] a code turned off is refused on the next order @regression', async ({ request }) => {
    const p = await makeProduct(request);
    const code = await makeCode(request);
    expect((await patchCode(request, code, { active: false })).status()).toBe(200);
    const res = await order(request, await signUp(request), p.id, 1, code);
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toBe('Discount code is not valid');
  });

  test('DC-EP-34 [DC-R12] codes cannot be deleted: DELETE is a 404 and the code stays @regression', async ({ request }) => {
    const code = await makeCode(request);
    expect((await request.delete(`/discounts/${code}`, { headers: admin().auth })).status()).toBe(404);
    expect((await getCode(request, code)).code).toBe(code);
  });
});

test.describe('orders with a code', () => {
  test('DC-EP-35 [DC-R20] a placed order keeps its discount when the code is changed or turned off @regression', async ({ request }) => {
    const me = await signUp(request);
    const p = await makeProduct(request, { price: 40, stock: 5 });
    const code = await makeCode(request, { value: 25, max_uses: 10 });
    const placed = await (await order(request, me, p.id, 1, code)).json();
    await patchCode(request, code, { active: false, max_uses: 1, expires_at: null });
    const later = await (await request.get(`/orders/${placed.id}`, { headers: me.auth })).json();
    expect(later).toEqual(placed);
    expect(later).toMatchObject({ subtotal: 40, discount_code: code, discount: 10, total: 30 });
  });

  test('DC-EP-36 [DC-R24] an admin placing orders follows the same rules @regression', async ({ request }) => {
    const p = await makeProduct(request, { stock: 5 });
    const code = await makeCode(request);
    expect((await order(request, admin(), p.id, 1, code)).status()).toBe(201);
    const again = await order(request, admin(), p.id, 1, code);
    expect(again.status()).toBe(422);
    expect((await again.json()).error).toBe('You have already used this discount code');
    expect((await getCode(request, code)).uses).toBe(1);
  });
});
