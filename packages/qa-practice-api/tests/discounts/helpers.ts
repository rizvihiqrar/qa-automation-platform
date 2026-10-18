// Shared setup for the discount code tests (Day 38 of docs/ai-written-code). Each
// case names its ID and the spec rule it checks (DC-BVA-01 with DC-R01 and so on);
// scripts/ai-written-code.test.mjs checks every rule has a case and the coverage
// table in docs/ai-written-code/code-review.md matches the files.
import type { APIRequestContext } from '@playwright/test';
import { signUp, admin, makeProduct, type Account } from '../design/helpers.ts';

export { signUp, admin, makeProduct, type Account };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// A random code of the given length. Codes are unique per server, so tests can't
// share fixed ones; 36^12 makes a clash between 12-character codes negligible.
export const uniqueCode = (length = 12): string =>
  Array.from({ length }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

export const createCode = (request: APIRequestContext, fields: Record<string, unknown>) =>
  request.post('/discounts', { headers: admin().auth, data: fields });

// A code that must be created for the test to make sense; returns its stored form.
export async function makeCode(request: APIRequestContext, fields: Record<string, unknown> = {}): Promise<string> {
  const res = await createCode(request, { code: uniqueCode(), type: 'percent', value: 10, ...fields });
  if (res.status() !== 201) throw new Error(`code setup failed: ${res.status()} ${await res.text()}`);
  return (await res.json()).code;
}

export const getCode = async (request: APIRequestContext, code: string) =>
  (await request.get(`/discounts/${code}`, { headers: admin().auth })).json();

export const patchCode = (request: APIRequestContext, code: string, data: unknown) =>
  request.patch(`/discounts/${code}`, { headers: admin().auth, data: data as Record<string, unknown> });

// One line of `quantity` of a product, with or without a code.
export const order = (request: APIRequestContext, account: Account, productId: number, quantity: number, discount_code?: unknown) =>
  request.post('/orders', {
    headers: account.auth,
    data: { items: [{ product_id: productId, quantity }], ...(discount_code === undefined ? {} : { discount_code }) },
  });

export const cancel = (request: APIRequestContext, account: Account, orderId: number) =>
  request.patch(`/orders/${orderId}/status`, { headers: account.auth, data: { status: 'cancelled' } });

// How many orders an account has, to show a refused order created nothing.
export const orderCount = async (request: APIRequestContext, account: Account): Promise<number> =>
  (await (await request.get('/orders', { headers: account.auth })).json()).length;

// A date-time `ms` from now, in the form the spec's example uses.
export const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
