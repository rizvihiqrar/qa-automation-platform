// Money is whole minor units (cents, yen, fils) as BigInt, from the moment a request
// is read to the moment a response is written. No amount is ever a JavaScript number:
// Day 39 showed JSON numbers lose digits before any code sees them (537704868.1699999
// arrives as 537704868.17), so amounts travel as strings and are parsed digit by digit.

// Decimals per currency (ISO 4217 minor units). BK-R02.
export const CURRENCIES = { CAD: 2, USD: 2, JPY: 0, KWD: 3 } as const;
export type Currency = keyof typeof CURRENCIES;

export const isCurrency = (value: unknown): value is Currency =>
  typeof value === 'string' && Object.hasOwn(CURRENCIES, value);

// The most money one currency may hold, in minor units (BK-R06). Every sum stays well
// inside SQLite's signed 64-bit integers, and the limit is above 2^53, so amounts a
// double can't hold exactly (90,071,992,547,409.93) are still exact here.
export const MAX_MINOR = 10n ** 17n - 1n;

// Payment scheme limits per currency, in minor units. A payment out (a withdrawal or a
// transfer) may not pass `single` (BK-R39), and one account may not send more than
// `daily` in one UTC day (BK-R40). Deposits are not payments out and have neither.
export const PAYMENT_LIMITS: Record<Currency, { single: bigint; daily: bigint }> = {
  CAD: { single: 1_000_000n, daily: 2_500_000n }, // 10,000.00 and 25,000.00
  USD: { single: 1_000_000n, daily: 2_500_000n },
  JPY: { single: 1_000_000n, daily: 2_500_000n }, // 1,000,000 and 2,500,000
  KWD: { single: 3_000_000n, daily: 7_500_000n }, // 3,000.000 and 7,500.000
};

// CAD per one unit of each currency, in ten-thousandths, fixed so that no rate is looked up
// (USD 1.37, JPY 0.0092, KWD 4.45).
export const DEMO_RATE_E4: Record<Currency, bigint> = { CAD: 10_000n, USD: 13_700n, JPY: 92n, KWD: 44_500n };

// The cash amount that must be reported (BK-R42, BK-R43): CAD 10,000.00 or more, and in the
// other currencies the smallest amount, in minor units, worth CAD 10,000 or more at those
// rates (USD 7,299.28, JPY 1,086,957, KWD 2,247.192): 10,000 CAD / rate, rounded up.
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
export const CASH_REPORT_THRESHOLD = Object.fromEntries(
  (Object.keys(CURRENCIES) as Currency[]).map((c) => [c, ceilDiv(10n ** 8n * 10n ** BigInt(CURRENCIES[c]), DEMO_RATE_E4[c])]),
) as Record<Currency, bigint>;
// The 24-hour rule looks back this far from the movement being screened (BK-R43).
export const CASH_WINDOW_MS = 24 * 60 * 60 * 1000;

// The payment reference a scheme message carries (BK-R38): 1 to 35 characters from the
// restricted set letters, digits, space and / - ? : ( ) . , ' +, with no space at either
// end. Anything else (accented letters, emoji, line breaks, # & % ;) is refused.
export const REFERENCE_MAX = 35;
const REFERENCE = /^[A-Za-z0-9/?:().,'+-](?:[A-Za-z0-9 /?:().,'+-]{0,33}[A-Za-z0-9/?:().,'+-])?$/;
export const isReference = (value: unknown): value is string => typeof value === 'string' && REFERENCE.test(value);

export type Parsed = { ok: true; minor: bigint } | { ok: false; error: string };

// Reads a request amount. BK-R01 to BK-R05: a string of plain digits, at most the
// currency's decimals, greater than zero, no larger than MAX_MINOR.
export function parseAmount(value: unknown, currency: Currency): Parsed {
  const decimals = CURRENCIES[currency];
  const example = decimals === 0 ? '"1250"' : `"12.${'5'.padEnd(decimals, '0')}"`;
  if (typeof value !== 'string') {
    return { ok: false, error: `amount must be a string such as ${example}` };
  }
  const pattern = decimals === 0 ? /^(0|[1-9][0-9]*)$/ : new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${decimals}})?$`);
  if (!pattern.test(value)) {
    const rule = decimals === 0 ? 'no decimals' : `at most ${decimals} decimals`;
    return { ok: false, error: `amount must be digits with ${rule} for ${currency}, such as ${example}` };
  }
  const [whole = '', fraction = ''] = value.split('.');
  const minor = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (minor === 0n) return { ok: false, error: 'amount must be greater than zero' };
  if (minor > MAX_MINOR) return { ok: false, error: `amount must be at most ${formatAmount(MAX_MINOR, currency)}` };
  return { ok: true, minor };
}

// Writes an amount with exactly the currency's decimals (BK-R07). Negative amounts
// appear on statements, as debits.
export function formatAmount(minor: bigint, currency: Currency): string {
  const decimals = CURRENCIES[currency];
  const sign = minor < 0n ? '-' : '';
  const digits = (minor < 0n ? -minor : minor).toString().padStart(decimals + 1, '0');
  if (decimals === 0) return sign + digits;
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
