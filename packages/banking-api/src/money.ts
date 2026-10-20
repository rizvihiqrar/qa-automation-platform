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
