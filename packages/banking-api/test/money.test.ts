import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MINOR, formatAmount, parseAmount, type Currency } from '../src/money.ts';

// Designed cases for reading and writing amounts. Each row names its technique:
// EP (equivalence partition), BVA (boundary value), or ERR (error guessing: inputs
// that break float or loose parsing).

type Accept = [technique: string, input: unknown, currency: Currency, minor: bigint, why: string];
type Refuse = [technique: string, input: unknown, currency: Currency, message: RegExp, why: string];

const accepted: Accept[] = [
  ['BVA', '0.01', 'CAD', 1n, 'the smallest CAD amount'],
  ['EP',  '12.34', 'CAD', 1234n, 'a typical amount'],
  ['EP',  '1', 'CAD', 100n, 'no decimals is fewer than two'],
  ['EP',  '1.5', 'CAD', 150n, 'one decimal'],
  ['ERR', '0.29', 'CAD', 29n, '0.29 * 100 is 28.999999999999996 as a double'],
  ['ERR', '1.15', 'CAD', 115n, '1.15 * 100 is 114.99999999999999 as a double'],
  ['ERR', '90071992547409.93', 'CAD', 9_007_199_254_740_993n, 'above 2^53 minor units: a double reads it as …992'],
  ['BVA', '999999999999999.99', 'CAD', MAX_MINOR, 'the largest amount'],
  ['EP',  '10.10', 'USD', 1010n, 'USD has two decimals'],
  ['BVA', '1', 'JPY', 1n, 'the smallest JPY amount'],
  ['BVA', '99999999999999999', 'JPY', MAX_MINOR, 'the largest JPY amount'],
  ['BVA', '0.001', 'KWD', 1n, 'the smallest KWD amount: three decimals'],
  ['EP',  '1.23', 'KWD', 1230n, 'fewer than three decimals'],
  ['BVA', '99999999999999.999', 'KWD', MAX_MINOR, 'the largest KWD amount'],
];

const refused: Refuse[] = [
  ['ERR', 12.34, 'CAD', /must be a string such as "12\.50"/, 'a JSON number (BK-R01)'],
  ['ERR', 537704868.17, 'CAD', /must be a string/, 'a JSON number that lost its digits on the way in'],
  ['EP',  null, 'CAD', /must be a string/, 'null'],
  ['EP',  undefined, 'CAD', /must be a string/, 'missing'],
  ['EP',  true, 'CAD', /must be a string/, 'a boolean'],
  ['EP',  ['1.00'], 'CAD', /must be a string/, 'a list holding a valid amount'],
  ['EP',  { amount: '1.00' }, 'CAD', /must be a string/, 'an object'],
  ['BVA', '1.005', 'CAD', /at most 2 decimals for CAD/, 'one decimal too many'],
  ['ERR', '1.230', 'CAD', /at most 2 decimals/, 'a third decimal, even a zero'],
  ['BVA', '1.0', 'JPY', /no decimals for JPY, such as "1250"/, 'JPY has no decimals'],
  ['BVA', '1.2345', 'KWD', /at most 3 decimals for KWD, such as "12\.500"/, 'four decimals in KWD'],
  ['EP',  '', 'CAD', /digits/, 'empty'],
  ['ERR', '-1.00', 'CAD', /digits/, 'a minus sign'],
  ['ERR', '+1.00', 'CAD', /digits/, 'a plus sign'],
  ['ERR', ' 1.00', 'CAD', /digits/, 'a leading space'],
  ['ERR', '1.00 ', 'CAD', /digits/, 'a trailing space'],
  ['ERR', '1.00\n', 'CAD', /digits/, 'a trailing newline'],
  ['ERR', '1e3', 'CAD', /digits/, 'an exponent'],
  ['ERR', '1,000.00', 'CAD', /digits/, 'a thousands separator'],
  ['ERR', '1_000', 'CAD', /digits/, 'a numeric separator'],
  ['ERR', '007', 'CAD', /digits/, 'leading zeros'],
  ['ERR', '00.50', 'CAD', /digits/, 'a leading zero before the point'],
  ['ERR', '.50', 'CAD', /digits/, 'no digit before the point'],
  ['ERR', '1.', 'CAD', /digits/, 'no digit after the point'],
  ['ERR', '0x10', 'CAD', /digits/, 'hexadecimal'],
  ['ERR', 'Infinity', 'CAD', /digits/, 'Infinity'],
  ['ERR', 'NaN', 'CAD', /digits/, 'NaN'],
  ['ERR', '١٢', 'CAD', /digits/, 'Arabic-Indic digits, which a \\d regex in some engines accepts'],
  ['BVA', '0', 'CAD', /greater than zero/, 'zero (BK-R05)'],
  ['BVA', '0.00', 'CAD', /greater than zero/, 'zero with decimals'],
  ['BVA', '0', 'JPY', /greater than zero/, 'zero yen'],
  ['BVA', '1000000000000000.00', 'CAD', /at most 999999999999999\.99/, 'one cent past the largest amount (BK-R06)'],
  ['BVA', '100000000000000000', 'JPY', /at most 99999999999999999/, 'one yen past the largest amount'],
];

for (const [technique, input, currency, minor, why] of accepted) {
  test(`BK-R02 BK-R03 BK-R04 [${technique}] ${JSON.stringify(input)} ${currency} reads as ${minor} minor units: ${why}`, () => {
    assert.deepEqual(parseAmount(input, currency), { ok: true, minor });
  });
}

for (const [technique, input, currency, message, why] of refused) {
  test(`BK-R01 BK-R02 BK-R03 BK-R05 [${technique}] ${JSON.stringify(input) ?? 'undefined'} ${currency} is refused: ${why}`, () => {
    const parsed = parseAmount(input, currency);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, message);
  });
}

const formatted: [bigint, Currency, string][] = [
  [0n, 'CAD', '0.00'],
  [1n, 'CAD', '0.01'],
  [100n, 'CAD', '1.00'],
  [-1n, 'CAD', '-0.01'],
  [-123456n, 'CAD', '-1234.56'],
  [MAX_MINOR, 'CAD', '999999999999999.99'],
  [9_007_199_254_740_993n, 'USD', '90071992547409.93'],
  [0n, 'JPY', '0'],
  [100n, 'JPY', '100'],
  [-5n, 'JPY', '-5'],
  [0n, 'KWD', '0.000'],
  [1n, 'KWD', '0.001'],
  [-1230n, 'KWD', '-1.230'],
];

for (const [minor, currency, text] of formatted) {
  test(`BK-R07 ${minor} minor units of ${currency} are written "${text}"`, () => {
    assert.equal(formatAmount(minor, currency), text);
  });
}
