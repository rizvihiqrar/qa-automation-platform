// Properties of orders placed with discount codes (Day 39 of docs/ai-written-code):
// for any cart and any code, the amounts match an exact BigInt reference. Runs
// against the app in this process (harness.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { startApi, centsOf, amountOf, type Api } from './harness.ts';
import { MAX_ORDER_CENTS } from '../../src/money.ts';

let api: Api;
let shopper: { id: number; token: string };
let codes = 0;
before(async () => { api = await startApi(); shopper = await api.customer(); });
after(() => api.close());

const uniqueCode = () => `P${process.pid}-${++codes}`.slice(0, 20);

// Prices and quantities a shop could have. Amounts are text, so the reference reads
// them exactly; the API gets the same text as a JSON number.
// Up to 99,999.99 × 1,000 on 5 lines: always under the order cap (DC-PR-09).
const price = fc.bigInt({ min: 1n, max: 9_999_999n }).map(amountOf);
const line = fc.record({ price, quantity: fc.integer({ min: 1, max: 1000 }) });
const cart = fc.array(line, { minLength: 1, maxLength: 5 });
const code = fc.oneof(
  fc.record({ type: fc.constant('percent' as const), value: fc.integer({ min: 1, max: 100 }) }),
  fc.record({ type: fc.constant('fixed' as const), value: fc.bigInt({ min: 1n, max: 999_999_99n }).map(amountOf) }),
);
const minSubtotal = fc.oneof(fc.constant('0.00'), fc.bigInt({ min: 0n, max: 99_999_999_99n }).map(amountOf));

// DC-R17: percent is subtotal × value / 100 to the nearest cent, half up; capped.
function expectedDiscount(subtotal: bigint, c: { type: string; value: number | string }): bigint {
  const raw = c.type === 'percent'
    ? (subtotal * BigInt(c.value) * 2n + 100n) / 200n
    : centsOf(String(c.value));
  return raw < subtotal ? raw : subtotal;
}

async function place(lines: { price: string; quantity: number }[], discount_code: string) {
  const customer = shopper; // each case uses a fresh code, so one customer can use each once
  const items = [];
  for (const l of lines) items.push({ product_id: await api.product(JSON.parse(l.price)), quantity: l.quantity });
  return api.call('POST', '/orders', { items, discount_code }, customer.token);
}

test('DC-PR-07 [DC-R16, DC-R17, DC-R18] any cart with any code: amounts match exact cents', async () => {
  await fc.assert(fc.asyncProperty(cart, code, minSubtotal, async (lines, c, min) => {
    const name = uniqueCode();
    const made = await api.call('POST', '/discounts', { code: name, ...c, value: JSON.parse(String(c.value)), min_subtotal: JSON.parse(min) }, api.admin);
    assert.equal(made.status, 201, JSON.stringify(made.body));

    const res = await place(lines, name);
    const subtotal = lines.reduce((sum, l) => sum + centsOf(l.price) * BigInt(l.quantity), 0n);
    if (subtotal < centsOf(min)) {
      assert.equal(res.status, 422, `subtotal ${amountOf(subtotal)} under ${min}`);
      return;
    }
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const discount = expectedDiscount(subtotal, c);
    assert.deepEqual(
      { subtotal: res.body.subtotal, discount: res.body.discount, total: res.body.total },
      { subtotal: JSON.parse(amountOf(subtotal)), discount: JSON.parse(amountOf(discount)), total: JSON.parse(amountOf(subtotal - discount)) },
    );
  }), { numRuns: 300 });
});

test('DC-PR-08 [DC-R17] percent codes round half a cent up, and only then', async () => {
  // Subtotals whose percentage ends in exactly half a cent, and their neighbours.
  const halfCent = fc.tuple(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 99_999 }), fc.integer({ min: -1, max: 1 }))
    .filter(([v, k]) => (k * 100 + 50) % v === 0)
    .map(([v, k, nudge]) => ({ v, subtotal: BigInt((k * 100 + 50) / v + nudge) }))
    .filter(({ subtotal }) => subtotal > 0n);
  await fc.assert(fc.asyncProperty(halfCent, async ({ v, subtotal }) => {
    const name = uniqueCode();
    await api.call('POST', '/discounts', { code: name, type: 'percent', value: v }, api.admin);
    const res = await place([{ price: amountOf(subtotal), quantity: 1 }], name);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.discount, JSON.parse(amountOf(expectedDiscount(subtotal, { type: 'percent', value: v }))));
  }), { numRuns: 200 });
});

// No rule limited a price or a quantity. With none, fast-check's first case was
// 1,037,432,767.71 × 136,558: subtotal 141,669,743,892,942.18, answered as …942.2
// (finding PM-01). Orders above 999,999,999.99 are now refused; below, exact.
test('DC-PR-09 [DC-R18] large orders: exact up to 999,999,999.99, refused above', async () => {
  const big = fc.record({
    price: fc.bigInt({ min: 1n, max: 999_999_999_999_999n }).map(amountOf), // prices the products API takes
    quantity: fc.integer({ min: 1, max: 1_000_000 }),
  });
  const edges = [
    [[{ price: '999999999.99', quantity: 1 }]],
    [[{ price: '333333333.33', quantity: 3 }]],
    [[{ price: '999999999.98', quantity: 1 }, { price: '0.01', quantity: 1 }]],
    [[{ price: '1000000000.00', quantity: 1 }]],
    [[{ price: '999999999.99', quantity: 1 }, { price: '0.01', quantity: 1 }]],
    [[{ price: '500000000.00', quantity: 2 }]],
  ];
  await fc.assert(fc.asyncProperty(fc.array(big, { minLength: 1, maxLength: 3 }), async (lines) => {
    const customer = shopper;
    const items = [];
    for (const l of lines) {
      const made = await api.call('POST', '/products', { name: 'Big', category: 'test', price: JSON.parse(l.price), stock: l.quantity }, api.admin);
      assert.equal(made.status, 201, `price ${l.price}: ${JSON.stringify(made.body)}`);
      items.push({ product_id: made.body.id, quantity: l.quantity });
    }
    const res = await api.call('POST', '/orders', { items }, customer.token);
    const subtotal = lines.reduce((sum, l) => sum + centsOf(l.price) * BigInt(l.quantity), 0n);
    if (subtotal > BigInt(MAX_ORDER_CENTS)) {
      assert.deepEqual([res.status, res.body.error], [400, 'Order subtotal must be at most 999999999.99'], `subtotal ${amountOf(subtotal)}`);
    } else {
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(centsOf(String(res.body.subtotal)), subtotal, `got ${res.body.subtotal}, expected ${amountOf(subtotal)}`);
    }
  }), { numRuns: 200, examples: edges as never });
});

test('DC-PR-10 [DC-R01, DC-R13] a code is found whatever its case and surrounding spaces', async () => {
  const chars = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-');
  const spaced = (s: string) => fc.tuple(fc.constantFrom('', ' ', '  ', '\t'), fc.constantFrom('', ' ', '\n')).map(([a, b]) => a + s + b);
  const swapCase = (s: string) => fc.array(fc.boolean(), { minLength: s.length, maxLength: s.length })
    .map((flips) => [...s].map((ch, i) => (flips[i] ? (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) : ch)).join(''));
  const scenario = fc.string({ unit: chars, minLength: 3, maxLength: 12 })
    .chain((s) => fc.tuple(fc.constant(`${s}${++codes}`.slice(-20)), fc.constant(null)))
    .chain(([s]) => fc.tuple(fc.constant(s), spaced(s), swapCase(s).chain(spaced)));
  await fc.assert(fc.asyncProperty(scenario, async ([base, created, used]) => {
    const made = await api.call('POST', '/discounts', { code: created, type: 'percent', value: 10 }, api.admin);
    if (made.status === 409) return; // fast-check shrinking can repeat a code
    assert.equal(made.status, 201, `${JSON.stringify(created)}: ${JSON.stringify(made.body)}`);
    assert.equal(made.body.code, base.toUpperCase());
    const res = await place([{ price: '10.00', quantity: 1 }], used);
    assert.equal(res.status, 201, `${JSON.stringify(used)}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.discount_code, base.toUpperCase());
  }), { numRuns: 200 });
});
