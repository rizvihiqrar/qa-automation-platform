import { Router } from 'express';
import * as store from '../db/store.ts';
import type { Discount } from '../db/store.ts';
import { requireAuth, requireAdmin } from '../middleware/auth.ts';

const router = Router();

// Discount codes (docs/ai-written-code/spec.md). Rule IDs in comments are from that spec.

const CODE_PATTERN = /^[A-Za-z0-9-]{3,20}$/;
// ISO 8601 date-time with a time zone: Z or an offset like +05:00.
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const EDITABLE = ['active', 'expires_at', 'max_uses'];

// Money is worked out in whole cents (DC-R18).
export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

const hasAtMostTwoDecimals = (n: number): boolean =>
  Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;

export const normalizeCode = (code: string): string => code.trim().toUpperCase();

// Orders currently counting against a code: placed with it and not cancelled (DC-R21, DC-R23).
function countingOrders(code: string): store.Order[] {
  const { data } = store.orders.findAll({ discount_code: code }, { page: 1, limit: Number.MAX_SAFE_INTEGER });
  return data.filter(o => o.status !== 'cancelled');
}

function view(discount: Discount) {
  const { code, type, value, expires_at, max_uses, min_subtotal, active, created_at } = discount;
  return {
    code, type, value, expires_at, max_uses, min_subtotal, active,
    uses: countingOrders(code).length,
    created_at,
  };
}

function findByCode(code: string): Discount | null {
  return store.discounts.findOne({ code: normalizeCode(code) });
}

// Each parser returns the parsed value or an error message.
function parseExpiresAt(v: unknown): string | null | { error: string } {
  if (v === null) return null;
  if (typeof v !== 'string' || !DATE_TIME_PATTERN.test(v) || Number.isNaN(Date.parse(v))) {
    return { error: 'expires_at must be an ISO 8601 date-time with a time zone, or null' };
  }
  if (Date.parse(v) <= Date.now()) return { error: 'expires_at must be in the future' };
  return v;
}

function parseMaxUses(v: unknown): number | null | { error: string } {
  if (v === null) return null;
  if (!Number.isInteger(v) || (v as number) < 1) {
    return { error: 'max_uses must be a whole number of at least 1, or null' };
  }
  return v as number;
}

function parseActive(v: unknown): boolean | { error: string } {
  return typeof v === 'boolean' ? v : { error: 'active must be true or false' };
}

const isError = (v: unknown): v is { error: string } =>
  typeof v === 'object' && v !== null && 'error' in v;

router.use(requireAuth, requireAdmin);

router.get('/', (_req, res) => {
  const { data } = store.discounts.findAll({}, { page: 1, limit: Number.MAX_SAFE_INTEGER });
  res.json(data.map(view));
});

router.get('/:code', (req, res) => {
  const discount = findByCode(String(req.params.code));
  if (!discount) return res.status(404).json({ error: `Discount code ${req.params.code} not found` });
  res.json(view(discount));
});

router.post('/', (req, res) => {
  const { code, type, value, expires_at = null, max_uses = null, min_subtotal = 0, active = true } = req.body ?? {};

  // DC-R01
  if (typeof code !== 'string' || !CODE_PATTERN.test(code.trim())) {
    return res.status(400).json({ error: 'code must be 3 to 20 letters, digits or hyphens' });
  }
  // DC-R03
  if (type !== 'percent' && type !== 'fixed') {
    return res.status(400).json({ error: 'type must be "percent" or "fixed"' });
  }
  // DC-R04
  if (type === 'percent' && (!Number.isInteger(value) || value < 1 || value > 100)) {
    return res.status(400).json({ error: 'value for a percent code must be a whole number from 1 to 100' });
  }
  if (type === 'fixed' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !hasAtMostTwoDecimals(value))) {
    return res.status(400).json({ error: 'value for a fixed code must be a number above 0 with at most two decimals' });
  }
  // DC-R05
  const expiresAt = parseExpiresAt(expires_at);
  if (isError(expiresAt)) return res.status(400).json(expiresAt);
  // DC-R06
  const maxUses = parseMaxUses(max_uses);
  if (isError(maxUses)) return res.status(400).json(maxUses);
  // DC-R07
  if (typeof min_subtotal !== 'number' || !Number.isFinite(min_subtotal) || min_subtotal < 0 || !hasAtMostTwoDecimals(min_subtotal)) {
    return res.status(400).json({ error: 'min_subtotal must be a number of at least 0 with at most two decimals' });
  }
  // DC-R08
  const isActive = parseActive(active);
  if (isError(isActive)) return res.status(400).json(isActive);

  // DC-R02
  const normalized = normalizeCode(code);
  if (store.discounts.findOne({ code: normalized })) {
    return res.status(409).json({ error: `Discount code ${normalized} already exists` });
  }

  const discount = store.discounts.insert({
    code: normalized, type, value,
    expires_at: expiresAt, max_uses: maxUses, min_subtotal, active: isActive,
  });
  res.status(201).json(view(discount));
});

// DC-R11: only active, expires_at and max_uses can change.
router.patch('/:code', (req, res) => {
  const discount = findByCode(String(req.params.code));
  if (!discount) return res.status(404).json({ error: `Discount code ${req.params.code} not found` });

  const body = req.body ?? {};
  const unknown = Object.keys(body).filter(k => !EDITABLE.includes(k));
  if (unknown.length) {
    return res.status(400).json({ error: `Only ${EDITABLE.join(', ')} can be changed (got ${unknown.join(', ')})` });
  }

  const changes: Partial<Discount> = {};
  if ('active' in body) {
    const v = parseActive(body.active);
    if (isError(v)) return res.status(400).json(v);
    changes.active = v;
  }
  if ('expires_at' in body) {
    const v = parseExpiresAt(body.expires_at);
    if (isError(v)) return res.status(400).json(v);
    changes.expires_at = v;
  }
  if ('max_uses' in body) {
    const v = parseMaxUses(body.max_uses);
    if (isError(v)) return res.status(400).json(v);
    if (v !== null && v < countingOrders(discount.code).length) {
      return res.status(409).json({ error: 'max_uses cannot be below the uses already counted' });
    }
    changes.max_uses = v;
  }

  // Table.update skips undefined values but keeps null, so expires_at/max_uses can be cleared.
  const updated = store.discounts.update(discount.id, changes);
  res.json(view(updated!));
});

// Checks a code for an order (DC-R15). Returns the discount in cents or a refusal.
export function checkDiscount(
  input: string,
  userId: number,
  subtotalCents: number,
): { code: string; discountCents: number } | { error: string } {
  const discount = findByCode(input);
  if (!discount || !discount.active) return { error: 'Discount code is not valid' };
  if (discount.expires_at !== null && Date.now() >= Date.parse(discount.expires_at)) {
    return { error: 'Discount code has expired' };
  }
  const counting = countingOrders(discount.code);
  if (discount.max_uses !== null && counting.length >= discount.max_uses) {
    return { error: 'Discount code has reached its usage limit' };
  }
  if (counting.some(o => o.user_id === userId)) {
    return { error: 'You have already used this discount code' };
  }
  if (subtotalCents < toCents(discount.min_subtotal)) {
    return { error: `Order subtotal must be at least ${discount.min_subtotal.toFixed(2)} to use this code` };
  }

  // DC-R17: percent rounds to the nearest cent, half up; both kinds capped at the subtotal.
  const raw = discount.type === 'percent'
    ? Math.round(subtotalCents * discount.value / 100)
    : toCents(discount.value);
  return { code: discount.code, discountCents: Math.min(raw, subtotalCents) };
}

export default router;
