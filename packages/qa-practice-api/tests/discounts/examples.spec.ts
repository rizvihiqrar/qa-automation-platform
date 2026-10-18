// The six worked examples in docs/ai-written-code/spec.md, run as written.
import { test, expect } from '@playwright/test';
import { signUp, makeProduct, makeCode, order } from './helpers.ts';

const examples: [id: string, rule: string, price: number, quantity: number, code: Record<string, unknown>, discount: number | null, total: number | null][] = [
  ['DC-EX-01', 'DC-R18', 29.99, 2, { type: 'percent', value: 10 }, 6.00, 53.98],
  ['DC-EX-02', 'DC-R18', 10.05, 1, { type: 'percent', value: 10 }, 1.01, 9.04],
  ['DC-EX-03', 'DC-R18', 20.00, 1, { type: 'fixed', value: 25 }, 20.00, 0],
  ['DC-EX-04', 'DC-R18', 50.00, 1, { type: 'fixed', value: 10, min_subtotal: 50 }, 10.00, 40.00],
  ['DC-EX-05', 'DC-R18', 49.99, 1, { type: 'fixed', value: 10, min_subtotal: 50 }, null, null],
  ['DC-EX-06', 'DC-R18', 0.10, 3, { type: 'percent', value: 100 }, 0.30, 0],
];

for (const [id, rule, price, quantity, fields, discount, total] of examples) {
  const subtotal = Math.round(price * 100 * quantity) / 100;
  const outcome = discount === null ? 'is refused with 422' : `gives ${discount.toFixed(2)} off, total ${total!.toFixed(2)}`;
  test(`${id} [${rule}] subtotal ${subtotal.toFixed(2)} with ${JSON.stringify(fields)} ${outcome} @regression`, async ({ request }) => {
    const p = await makeProduct(request, { price, stock: quantity });
    const code = await makeCode(request, fields);
    const res = await order(request, await signUp(request), p.id, quantity, code);
    if (discount === null) {
      expect(res.status()).toBe(422);
      return;
    }
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ subtotal, discount_code: code, discount, total });
  });
}
