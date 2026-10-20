import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { CURRENCIES, MAX_MINOR, formatAmount, parseAmount, type Currency } from '../src/money.ts';

// Property-based tests (fast-check) for reading and writing amounts. Each title
// starts with its ID and the rules it checks.

const currency = fc.constantFrom(...(Object.keys(CURRENCIES) as Currency[]));
const minor = fc.bigInt({ min: 1n, max: MAX_MINOR });

test('BK-PR-01 BK-R02 BK-R07 any amount, written and read back, is the same number of minor units', () => {
  fc.assert(fc.property(currency, minor, (c, m) => {
    assert.deepEqual(parseAmount(formatAmount(m, c), c), { ok: true, minor: m });
  }), { numRuns: 2000 });
});

test('BK-PR-02 BK-R02 trailing zeros may be left off: "12.5" is "12.50"', () => {
  fc.assert(fc.property(currency, minor, (c, m) => {
    const shortest = formatAmount(m, c).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    assert.deepEqual(parseAmount(shortest, c), { ok: true, minor: m });
  }), { numRuns: 2000 });
});

test('BK-PR-03 BK-R02 one decimal more than the currency allows is always refused, whatever the digit', () => {
  fc.assert(fc.property(currency, minor, fc.integer({ min: 0, max: 9 }), (c, m, digit) => {
    const written = formatAmount(m, c);
    const longer = CURRENCIES[c] === 0 ? `${written}.${digit}` : `${written}${digit}`;
    assert.equal(parseAmount(longer, c).ok, false);
  }), { numRuns: 2000 });
});

test('BK-PR-04 BK-R01 a JSON number is never accepted, however round', () => {
  const number = fc.oneof(fc.integer(), fc.double(), fc.constant(0), fc.constant(1), fc.constant(12.34), fc.constant(Number.MAX_SAFE_INTEGER));
  fc.assert(fc.property(currency, number, (c, n) => {
    const parsed = parseAmount(n, c);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /must be a string/);
  }), { numRuns: 1000 });
});

test('BK-PR-05 BK-R03 any text that is accepted is plain digits and is written back exactly as sent, give or take trailing zeros', () => {
  // Strings built from the characters that matter, so accepted ones are common enough to check.
  const text = fc.string({ unit: fc.constantFrom('0', '1', '9', '.', '-', '+', 'e', ' ', ',', '_'), maxLength: 22 });
  fc.assert(fc.property(currency, fc.oneof(text, fc.string()), (c, s) => {
    const parsed = parseAmount(s, c);
    if (!parsed.ok) return;
    assert.match(s, /^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
    const [whole = '', fraction = ''] = s.split('.');
    const decimals = CURRENCIES[c];
    const expected = decimals === 0 ? whole : `${whole}.${fraction.padEnd(decimals, '0')}`;
    assert.equal(formatAmount(parsed.minor, c), expected);
  }), { numRuns: 5000 });
});

test('BK-PR-06 BK-R04 BK-R06 amounts no double can hold are still exact: each one more than the last', () => {
  // Doubles stop telling neighbours apart above 2^53; minor units never do.
  const high = fc.bigInt({ min: 2n ** 53n, max: MAX_MINOR - 1n });
  fc.assert(fc.property(currency, high, (c, m) => {
    const next = parseAmount(formatAmount(m + 1n, c), c);
    assert.ok(next.ok);
    if (next.ok) assert.equal(next.minor - m, 1n);
  }), { numRuns: 1000 });
});

test('BK-PR-07 BK-R05 BK-R06 every amount from zero to the limit is accepted exactly when it is between 1 and MAX_MINOR', () => {
  const around = fc.oneof(fc.bigInt({ min: 0n, max: 3n }), fc.bigInt({ min: MAX_MINOR - 3n, max: MAX_MINOR + 3n }), fc.bigInt({ min: 0n, max: MAX_MINOR * 10n }));
  fc.assert(fc.property(currency, around, (c, m) => {
    assert.equal(parseAmount(formatAmount(m, c), c).ok, m >= 1n && m <= MAX_MINOR);
  }), { numRuns: 2000 });
});
