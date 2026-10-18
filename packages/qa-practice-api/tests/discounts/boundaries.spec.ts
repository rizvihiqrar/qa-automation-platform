// Boundary value analysis on the AI-written discount codes: each edge of every
// range in docs/ai-written-code/spec.md, with the value just inside and just
// outside it. Money steps are one cent; dates step across real calendar edges.
import { test, expect } from '@playwright/test';
import { signUp, admin, makeProduct, uniqueCode, createCode, makeCode, getCode, order, fromNow, sleep } from './helpers.ts';

type Case = [id: string, rule: string, label: string, fields: Record<string, unknown>, status: number];

const percent = (fields: Record<string, unknown>) => ({ code: uniqueCode(), type: 'percent', value: 10, ...fields });
const fixed = (value: number) => ({ code: uniqueCode(), type: 'fixed', value });

test.describe('creating a code', () => {
  const cases: Case[] = [
    ['DC-BVA-01', 'DC-R01', 'code of 2 characters', percent({ code: uniqueCode(2) }), 400],
    ['DC-BVA-02', 'DC-R01', 'code of 3 characters', percent({ code: uniqueCode(3) }), 201],
    ['DC-BVA-03', 'DC-R01', 'code of 20 characters', percent({ code: uniqueCode(20) }), 201],
    ['DC-BVA-04', 'DC-R01', 'code of 21 characters', percent({ code: uniqueCode(21) }), 400],
    ['DC-BVA-05', 'DC-R01', 'code of 2 characters inside spaces', percent({ code: `  ${uniqueCode(2)}  ` }), 400],
    ['DC-BVA-06', 'DC-R01', 'code of 20 characters inside spaces', percent({ code: ` ${uniqueCode(20)} ` }), 201],
    ['DC-BVA-07', 'DC-R04', 'percent value 0', percent({ value: 0 }), 400],
    ['DC-BVA-08', 'DC-R04', 'percent value 1', percent({ value: 1 }), 201],
    ['DC-BVA-09', 'DC-R04', 'percent value 100', percent({ value: 100 }), 201],
    ['DC-BVA-10', 'DC-R04', 'percent value 101', percent({ value: 101 }), 400],
    ['DC-BVA-11', 'DC-R04', 'fixed value 0', fixed(0), 400],
    ['DC-BVA-12', 'DC-R04', 'fixed value 0.01', fixed(0.01), 201],
    ['DC-BVA-13', 'DC-R04', 'fixed value 0.001', fixed(0.001), 400],
    ['DC-BVA-14', 'DC-R04', 'fixed value 10.000000000001', fixed(10.000000000001), 400],
    ['DC-BVA-15', 'DC-R04', 'fixed value 0.1 + 0.2 (0.30000000000000004)', fixed(0.1 + 0.2), 400],
    ['DC-BVA-16', 'DC-R07', 'min_subtotal -0.01', percent({ min_subtotal: -0.01 }), 400],
    ['DC-BVA-17', 'DC-R07', 'min_subtotal 0', percent({ min_subtotal: 0 }), 201],
    ['DC-BVA-18', 'DC-R07', 'min_subtotal 0.01', percent({ min_subtotal: 0.01 }), 201],
    ['DC-BVA-19', 'DC-R07', 'min_subtotal 49.999999999999', percent({ min_subtotal: 49.999999999999 }), 400],
    ['DC-BVA-20', 'DC-R06', 'max_uses 0', percent({ max_uses: 0 }), 400],
    ['DC-BVA-21', 'DC-R06', 'max_uses 1', percent({ max_uses: 1 }), 201],
    ['DC-BVA-22', 'DC-R05', 'expires_at a minute ago', percent({ expires_at: fromNow(-60_000) }), 400],
    ['DC-BVA-23', 'DC-R05', 'expires_at a minute from now', percent({ expires_at: fromNow(60_000) }), 201],
    ['DC-BVA-24', 'DC-R05', 'expires_at 29 February in a leap year', percent({ expires_at: '2028-02-29T12:00:00Z' }), 201],
    ['DC-BVA-25', 'DC-R05', 'expires_at 29 February in a common year', percent({ expires_at: '2027-02-29T12:00:00Z' }), 400],
    ['DC-BVA-26', 'DC-R05', 'expires_at 30 February', percent({ expires_at: '2028-02-30T12:00:00Z' }), 400],
    ['DC-BVA-27', 'DC-R05', 'expires_at 31 April', percent({ expires_at: '2027-04-31T12:00:00Z' }), 400],
    ['DC-BVA-28', 'DC-R05', 'expires_at month 13', percent({ expires_at: '2027-13-01T12:00:00Z' }), 400],
    ['DC-BVA-29', 'DC-R05', 'expires_at 23:59:59 on 31 December', percent({ expires_at: '2027-12-31T23:59:59Z' }), 201],
    ['DC-BVA-30', 'DC-R05', 'expires_at second 60', percent({ expires_at: '2027-12-31T23:59:60Z' }), 400],
  ];
  for (const [id, rule, label, fields, status] of cases) {
    test(`${id} [${rule}] ${label} returns ${status} @regression`, async ({ request }) => {
      const res = await createCode(request, fields);
      expect(res.status(), await res.text()).toBe(status);
      // What was accepted is stored as sent (the code trimmed and in upper case).
      if (status === 201) {
        const body = await res.json();
        expect(body.code).toBe(String(fields.code).trim().toUpperCase());
        for (const k of ['value', 'min_subtotal', 'max_uses', 'expires_at'] as const) {
          if (k in fields) expect(body[k]).toBe(fields[k]);
        }
      }
    });
  }
});

test.describe('using a code', () => {
  test('DC-BVA-31 [DC-R05] a code works before expires_at and has expired at it @regression', async ({ request }) => {
    const p = await makeProduct(request, { price: 10, stock: 10 });
    const code = await makeCode(request, { expires_at: fromNow(2_000) });
    expect((await order(request, await signUp(request), p.id, 1, code)).status()).toBe(201);
    await sleep(2_100);
    const late = await order(request, await signUp(request), p.id, 1, code);
    expect(late.status()).toBe(422);
    expect((await late.json()).error).toBe('Discount code has expired');
  });

  const minimum: [id: string, rule: string, price: number, status: number][] = [
    ['DC-BVA-32', 'DC-R16', 49.99, 422],
    ['DC-BVA-33', 'DC-R16', 50.00, 201],
    ['DC-BVA-34', 'DC-R16', 50.01, 201],
  ];
  for (const [id, rule, price, status] of minimum) {
    test(`${id} [${rule}] subtotal ${price.toFixed(2)} against a minimum of 50.00 returns ${status} @regression`, async ({ request }) => {
      const p = await makeProduct(request, { price, stock: 1 });
      const code = await makeCode(request, { type: 'fixed', value: 10, min_subtotal: 50 });
      const res = await order(request, await signUp(request), p.id, 1, code);
      expect(res.status()).toBe(status);
      if (status === 422) expect((await res.json()).error).toBe('Order subtotal must be at least 50.00 to use this code');
    });
  }

  test('DC-BVA-35 [DC-R21] max_uses 2: the second use is allowed, the third refused @regression', async ({ request }) => {
    const p = await makeProduct(request, { stock: 10 });
    const code = await makeCode(request, { max_uses: 2 });
    for (const status of [201, 201, 422]) {
      expect((await order(request, await signUp(request), p.id, 1, code)).status()).toBe(status);
    }
    expect((await getCode(request, code)).uses).toBe(2);
  });

  // Percent rounds to the nearest cent, half a cent up (DC-R17); fixed is capped at the subtotal.
  const amounts: [id: string, rule: string, label: string, price: number, code: Record<string, unknown>, discount: number, total: number][] = [
    ['DC-BVA-36', 'DC-R17', '10% of 10.04 (1.004)', 10.04, { type: 'percent', value: 10 }, 1.00, 9.04],
    ['DC-BVA-37', 'DC-R17', '10% of 10.05 (1.005)', 10.05, { type: 'percent', value: 10 }, 1.01, 9.04],
    ['DC-BVA-38', 'DC-R17', '10% of 10.06 (1.006)', 10.06, { type: 'percent', value: 10 }, 1.01, 9.05],
    ['DC-BVA-39', 'DC-R17', 'fixed 19.99 off 20.00', 20.00, { type: 'fixed', value: 19.99 }, 19.99, 0.01],
    ['DC-BVA-40', 'DC-R17', 'fixed 20.00 off 20.00', 20.00, { type: 'fixed', value: 20.00 }, 20.00, 0],
    ['DC-BVA-41', 'DC-R17', 'fixed 20.01 off 20.00, capped', 20.00, { type: 'fixed', value: 20.01 }, 20.00, 0],
  ];
  for (const [id, rule, label, price, fields, discount, total] of amounts) {
    test(`${id} [${rule}] ${label} gives discount ${discount.toFixed(2)} and total ${total.toFixed(2)} @regression`, async ({ request }) => {
      const p = await makeProduct(request, { price, stock: 1 });
      const code = await makeCode(request, fields);
      const res = await order(request, await signUp(request), p.id, 1, code);
      expect(res.status()).toBe(201);
      expect(await res.json()).toMatchObject({ subtotal: price, discount, total });
    });
  }
});

// The spec's amounts are whole cents; a product price that isn't can't be added up
// in cents without changing it (code review finding CR-05).
test.describe('product prices in whole cents', () => {
  const cases: [id: string, rule: string, price: number, status: number][] = [
    ['DC-BVA-42', 'DC-R16', 19.99, 201],
    ['DC-BVA-43', 'DC-R16', 19.999, 400],
  ];
  for (const [id, rule, price, status] of cases) {
    test(`${id} [${rule}] a product priced ${price} returns ${status} @regression`, async ({ request }) => {
      const res = await request.post('/products', {
        headers: admin().auth,
        data: { name: 'Cents Widget', category: 'design', price, stock: 1 },
      });
      expect(res.status()).toBe(status);
    });
  }
});
