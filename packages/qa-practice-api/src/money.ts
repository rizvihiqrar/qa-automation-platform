// Money is worked out in whole cents (docs/ai-written-code/spec.md, DC-R18).

export const toCents = (amount: number): number => Math.round(amount * 100);

// The largest order subtotal, 999,999,999.99. Cents are exact in a double only up
// to 2^53 (about 90 trillion dollars); with no limit at all, a property test
// (DC-PR-09, finding PM-01) found an order whose subtotal lost two cents.
export const MAX_ORDER_CENTS = 99_999_999_999;
export const fromCents = (cents: number): number => cents / 100;

// True when `n` is exactly a dollar amount with at most two decimals, as JSON
// parses it: 0.29 is (0.29 * 100 is 28.999…96, but rounds back to 0.29), while
// 10.000000000001 and 0.1 + 0.2 are not. A tolerance on n * 100 accepted both.
export const isWholeCents = (n: number): boolean =>
  Number.isFinite(n) && fromCents(toCents(n)) === n;
