import type { Request } from 'express';

// Page and limit from the query string, clamped to sensible ranges.
// Query values can be strings, arrays or objects, so anything else falls back to the default.
export function pagination(query: Request['query']): { page: number; limit: number } {
  const num = (v: unknown) => (typeof v === 'string' ? parseInt(v) : NaN);
  return {
    page: Math.max(1, num(query.page) || 1),
    limit: Math.min(50, Math.max(1, num(query.limit) || 10)),
  };
}
