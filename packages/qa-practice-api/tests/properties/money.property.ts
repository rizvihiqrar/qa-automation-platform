// Properties of src/money.ts (Day 39 of docs/ai-written-code). Each test name starts
// with its ID (DC-PR-xx) and the spec rule it checks; scripts/ai-written-code.test.mjs
// reads them. The reference is BigInt cents read from the amount's text, which
// shares nothing with the floats under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { toCents, fromCents, isWholeCents, MAX_ORDER_CENTS as MAX_CENTS } from '../../src/money.ts';
import { centsOf, amountOf } from './harness.ts';

// Amounts as a person types them: whole-cent text, parsed the way JSON does.
const wholeCentAmount = fc.bigInt({ min: 0n, max: BigInt(MAX_CENTS) }).map(amountOf);

test('DC-PR-01 [DC-R07] every amount from 0.00 to 9,999.99 is whole cents and reads as its cents', () => {
  // Exhaustive: one million amounts, so no sampling can miss a value like 0.29.
  for (let c = 0n; c < 1_000_000n; c++) {
    const text = amountOf(c);
    const n = JSON.parse(text);
    if (!isWholeCents(n) || BigInt(toCents(n)) !== c) assert.fail(`${text}: isWholeCents ${isWholeCents(n)}, toCents ${toCents(n)}`);
  }
});

test('DC-PR-02 [DC-R07] any larger whole-cent amount is whole cents and reads as its cents', () => {
  fc.assert(fc.property(wholeCentAmount, (text) => {
    const n = JSON.parse(text);
    assert.ok(isWholeCents(n), `${text} refused`);
    assert.equal(BigInt(toCents(n)), centsOf(text));
  }), { numRuns: 10_000 });
});

test('DC-PR-03 [DC-R18] cents turn into an amount and back unchanged, up to 999,999,999.99', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: MAX_CENTS }), (c) => {
    assert.equal(toCents(fromCents(c)), c);
    assert.equal(fromCents(c), JSON.parse(amountOf(c)), 'fromCents is the amount as written');
  }), { numRuns: 10_000 });
});

// Text with more decimals lies between two whole-cent amounts. It is refused unless
// the number JSON reads from it already IS one of them: a double has about 16
// significant digits, so 537704868.1699999 reads as exactly 537704868.17 (fast-check's
// first counterexample here). No code after JSON.parse can tell those two apart.
test('DC-PR-04 [DC-R04] an amount with a non-zero third decimal is refused unless JSON reads it as whole cents', () => {
  const subCent = fc.tuple(fc.bigInt({ min: 0n, max: BigInt(MAX_CENTS) - 1n }), fc.integer({ min: 1, max: 9 }), fc.nat({ max: 9999 }))
    .map(([c, third, more]) => ({ c, text: `${amountOf(c)}${third}${more ? String(more).padStart(4, '0') : ''}` }));
  fc.assert(fc.property(subCent, ({ c, text }) => {
    const n = JSON.parse(text);
    const readAsWholeCents = n === JSON.parse(amountOf(c)) || n === JSON.parse(amountOf(c + 1n));
    assert.equal(isWholeCents(n), readAsWholeCents, text);
  }), { numRuns: 10_000 });
});

test('DC-PR-05 [DC-R04] below 1,000,000.00, any non-zero third decimal is refused', () => {
  // Here a double still holds 9 or more decimals, so no third decimal can vanish.
  const subCent = fc.tuple(fc.bigInt({ min: 0n, max: 99_999_999n }), fc.integer({ min: 1, max: 9 }))
    .map(([c, third]) => `${amountOf(c)}${third}`);
  fc.assert(fc.property(subCent, (text) => {
    assert.equal(isWholeCents(JSON.parse(text)), false, `${text} accepted`);
  }), { numRuns: 10_000 });
});

test('DC-PR-06 [DC-R04] non-finite numbers are never whole cents', () => {
  for (const n of [NaN, Infinity, -Infinity]) assert.equal(isWholeCents(n), false, String(n));
});
