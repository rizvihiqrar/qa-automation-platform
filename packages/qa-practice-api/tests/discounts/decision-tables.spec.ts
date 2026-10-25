// Decision tables for placing an order with a discount code. The first table
// combines the five refusal conditions of DC-R15 to check which one wins; the
// second combines bad items with a bad discount_code to check which error wins.
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  signUp, makeProduct, uniqueCode, makeCode, getCode, patchCode, order, orderCount, fromNow, waitUntilServerReaches, type Account,
} from './helpers.ts';
import { stockOf } from '../design/helpers.ts';

const NOT_VALID = 'Discount code is not valid';
const EXPIRED = 'Discount code has expired';
const LIMIT = 'Discount code has reached its usage limit';
const USED = 'You have already used this discount code';
const MINIMUM = 'Order subtotal must be at least 50.00 to use this code';

interface Setup { code: string; me: Account }

// Each condition is made true the way a real shop would get there.
async function setUp(request: APIRequestContext, c: {
  known?: boolean; inactive?: boolean; expired?: boolean; atLimit?: boolean; usedByMe?: boolean; belowMin?: boolean;
}): Promise<Setup> {
  const me = await signUp(request);
  if (c.known === false) return { code: uniqueCode(), me };
  const big = await makeProduct(request, { price: 60, stock: 10 });
  const expiresAt = fromNow(1_500);
  const code = await makeCode(request, {
    ...(c.expired ? { expires_at: expiresAt } : {}),
    ...(c.atLimit ? { max_uses: 1 } : {}),
    ...(c.belowMin ? { min_subtotal: 50 } : {}),
  });
  // A use by me (which also fills a limit of 1), or by someone else.
  if (c.usedByMe) expect((await order(request, me, big.id, 1, code)).status()).toBe(201);
  else if (c.atLimit) expect((await order(request, await signUp(request), big.id, 1, code)).status()).toBe(201);
  if (c.expired) await waitUntilServerReaches(request, expiresAt);
  if (c.inactive) expect((await patchCode(request, code, { active: false })).status()).toBe(200);
  return { code, me };
}

test.describe('which refusal wins (DC-R15)', () => {
  const rows: [id: string, rule: string, label: string, conditions: Parameters<typeof setUp>[1], error: string | null][] = [
    ['DC-DT-01', 'DC-R15', 'no such code', { known: false }, NOT_VALID],
    ['DC-DT-02', 'DC-R15', 'turned off', { inactive: true }, NOT_VALID],
    ['DC-DT-03', 'DC-R15', 'turned off and expired', { inactive: true, expired: true }, NOT_VALID],
    ['DC-DT-04', 'DC-R15', 'expired', { expired: true }, EXPIRED],
    ['DC-DT-05', 'DC-R15', 'expired and at its limit', { expired: true, atLimit: true }, EXPIRED],
    ['DC-DT-06', 'DC-R15', 'at its limit', { atLimit: true }, LIMIT],
    ['DC-DT-07', 'DC-R15', 'at its limit through my own use', { atLimit: true, usedByMe: true }, LIMIT],
    ['DC-DT-08', 'DC-R15', 'already used by me', { usedByMe: true }, USED],
    ['DC-DT-09', 'DC-R15', 'already used by me and below the minimum', { usedByMe: true, belowMin: true }, USED],
    ['DC-DT-10', 'DC-R15', 'below the minimum', { belowMin: true }, MINIMUM],
    ['DC-DT-11', 'DC-R15', 'none of them', {}, null],
  ];
  for (const [id, rule, label, conditions, error] of rows) {
    const outcome = error ? `422 "${error}" and changes nothing` : '201';
    test(`${id} [${rule}] code ${label}: ${outcome} @regression`, async ({ request }) => {
      const { code, me } = await setUp(request, conditions);
      const p = await makeProduct(request, { price: 10, stock: 5 });
      const usesBefore = conditions.known === false ? null : (await getCode(request, code)).uses;
      const ordersBefore = await orderCount(request, me);

      const res = await order(request, me, p.id, 1, code.toLowerCase());
      if (!error) {
        expect(res.status()).toBe(201);
        expect((await res.json()).discount_code).toBe(code);
        return;
      }
      expect(res.status()).toBe(422);
      expect(await res.json()).toEqual({ error });
      // A refused order changes nothing: no order, no stock taken, no use counted.
      expect(await orderCount(request, me)).toBe(ordersBefore);
      expect(await stockOf(request, p.id)).toBe(5);
      if (usesBefore !== null) expect((await getCode(request, code)).uses).toBe(usesBefore);
    });
  }
});

test.describe('bad items and a bad discount_code together (DC-R13 to DC-R15)', () => {
  const ITEM = 'Each item needs product_id and a whole-number quantity >= 1';
  const CODE = 'discount_code must be a non-empty string or null';
  // `stock 5` lines ask for 6 of a product with 5 in stock.
  const rows: [id: string, rule: string, label: string, line: 'unknown' | 'zero' | 'stock' | 'ok', discount: unknown, status: number, error: string | RegExp | null][] = [
    ['DC-DT-12', 'DC-R15', 'unknown product, discount_code 5', 'unknown', 5, 404, /^Product \d+ not found$/],
    ['DC-DT-13', 'DC-R15', 'quantity 0, discount_code 5', 'zero', 5, 400, ITEM],
    ['DC-DT-14', 'DC-R15', 'not enough stock, discount_code ""', 'stock', '', 400, /^Insufficient stock/],
    ['DC-DT-15', 'DC-R15', 'not enough stock, unknown code', 'stock', 'NO-SUCH-CODE', 400, /^Insufficient stock/],
    ['DC-DT-16', 'DC-R13', 'valid items, discount_code 5', 'ok', 5, 400, CODE],
    ['DC-DT-17', 'DC-R13', 'valid items, discount_code of spaces', 'ok', '   ', 400, CODE],
    ['DC-DT-18', 'DC-R14', 'valid items, two codes in a list', 'ok', ['A1B2C3', 'D4E5F6'], 400, CODE],
    ['DC-DT-19', 'DC-R13', 'valid items, discount_code null', 'ok', null, 201, null],
    ['DC-DT-20', 'DC-R19', 'valid items, no discount_code', 'ok', undefined, 201, null],
  ];
  for (const [id, rule, label, line, discount, status, error] of rows) {
    test(`${id} [${rule}] ${label} returns ${status} @regression`, async ({ request }) => {
      const me = await signUp(request);
      const p = await makeProduct(request, { stock: 5 });
      const lines: Record<typeof line, [productId: number, quantity: number]> = {
        unknown: [999_999, 1], zero: [p.id, 0], stock: [p.id, 6], ok: [p.id, 1],
      };
      const [productId, quantity] = lines[line];
      const res = await order(request, me, productId, quantity, discount);
      expect(res.status()).toBe(status);
      const body = await res.json();
      if (error) expect(body.error).toMatch(error);
      else expect(body).toMatchObject({ discount_code: null, discount: 0, subtotal: 10, total: 10 });
    });
  }

  test('DC-DT-21 [DC-R13] valid items, a known code in lower case inside spaces returns 201 with the code in upper case @regression', async ({ request }) => {
    const code = await makeCode(request);
    const p = await makeProduct(request, { price: 20, stock: 1 });
    const res = await order(request, await signUp(request), p.id, 1, `  ${code.toLowerCase()}  `);
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ discount_code: code, subtotal: 20, discount: 2, total: 18 });
  });
});
