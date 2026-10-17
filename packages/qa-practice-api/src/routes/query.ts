import type { Request } from 'express';

// Page and limit from the query string, clamped to sensible ranges.
// Query values can be strings, arrays or objects, so anything else falls back to the default.
// Only a missing or non-numeric value takes the default: `|| 10` used to send
// limit=0 to 10 while limit=-1 went to 1 (found by boundary value analysis).
export function pagination(query: Request['query']): { page: number; limit: number } {
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === 'string' ? parseInt(v) : NaN;
    return Number.isNaN(n) ? fallback : n;
  };
  return {
    page: Math.max(1, num(query.page, 1)),
    limit: Math.min(50, Math.max(1, num(query.limit, 10))),
  };
}
