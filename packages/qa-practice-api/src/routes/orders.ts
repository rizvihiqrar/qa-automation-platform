import { Router } from 'express';
import * as store from '../db/store.ts';
import type { Request } from 'express';
import { requireAuth, currentUser, isAdmin } from '../middleware/auth.ts';
import { checkDiscount } from './discounts.ts';
import { toCents, fromCents, MAX_ORDER_CENTS } from '../money.ts';
import { handle, reply, send, type Reply } from '../middleware/handle.ts';

const router = Router();

// The order lifecycle (state-transition design in docs/test-strategy/test-plan.md).
// Any status used to be settable from any other, so a delivered order could go
// back to pending and a cancelled one could ship.
const NEXT: Record<string, string[]> = {
  pending:    ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped:    ['delivered'],
  delivered:  [],
  cancelled:  [],
};
const VALID_STATUSES = Object.keys(NEXT);

// Moving an order along (processing, shipped, delivered) is the shop's job; a
// customer may only cancel. Customers used to be able to mark their own orders delivered.
const CUSTOMER_MOVES = ['cancelled'];

// Admins see every order. A customer sees only their own; anyone else's is
// answered as not found, so order ids can't be probed.
async function visibleOrder(req: Request, tables: store.Tables = store, options?: store.FindOptions): Promise<store.Order | null> {
  const order = await tables.orders.findById(String(req.params.id), options);
  return order && (isAdmin(req) || order.user_id === currentUser(req).id) ? order : null;
}

router.use(requireAuth);

// Locks each product row, lowest id first. Two orders taking the same products in
// different orders would otherwise each hold one row and wait for the other's
// (a deadlock, which Postgres ends by failing one of them).
async function lockProducts(tx: store.Tables, ids: unknown[]): Promise<void> {
  const unique = [...new Set(ids.map((id) => parseInt(String(id))))].filter(Number.isSafeInteger);
  for (const id of unique.sort((a, b) => a - b)) await tx.products.findById(id, { lock: true });
}

router.get('/', handle(async (req, res) => {
  const filter = isAdmin(req) ? {} : { user_id: currentUser(req).id };
  const { data } = await store.orders.findAll(filter, { page: 1, limit: 1000 });
  res.json(data.sort((a, b) => b.created_at.localeCompare(a.created_at)));
}));

router.get('/:id', handle(async (req, res) => {
  const order = await visibleOrder(req);
  if (!order) return res.status(404).json({ error: `Order ${req.params.id} not found` });
  res.json(order);
}));

// The whole order runs in one transaction with its products and discount code
// locked: two orders for the last item used to be able to both read stock 1 and
// both succeed once each read waited on the database (tests/concurrency.spec.ts).
router.post('/', handle(async (req, res) => {
  const { items, discount_code = null } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  send(res, await store.transaction((tx) => placeOrder(tx, req, items, discount_code)));
}));

async function placeOrder(tx: store.Tables, req: Request, items: any[], discount_code: unknown): Promise<Reply> {
  await lockProducts(tx, items.map((item) => item?.product_id));
  let subtotalCents = 0;
  const resolvedItems: store.OrderItem[] = [];
  // Quantity requested per product across all lines. Stock used to be checked
  // line by line, so two lines for the same product could each pass and oversell it.
  const requested = new Map<number, { product: store.Product; quantity: number }>();

  for (const item of items) {
    // `item ?? {}`: a null line used to crash the route (500). Whole numbers only:
    // 1.5 left stock at 8.5, and "2" + "3" was joined as text into 23.
    const { product_id, quantity } = item ?? {};
    if (!product_id || !Number.isInteger(quantity) || quantity < 1) {
      return reply(400, { error: 'Each item needs product_id and a whole-number quantity >= 1' });
    }
    const product = await tx.products.findById(product_id);
    if (!product) return reply(404, { error: `Product ${product_id} not found` });
    const wanted = (requested.get(product.id)?.quantity ?? 0) + quantity;
    if (product.stock < wanted) {
      return reply(400, {
        error: `Insufficient stock for product ${product_id} (available: ${product.stock})`,
      });
    }
    requested.set(product.id, { product, quantity: wanted });
    subtotalCents += toCents(product.price) * quantity;
    resolvedItems.push({ product_id: product.id, name: product.name, price: product.price, quantity });
  }
  // Finding PM-01: past 2^53 cents the subtotal silently lost cents.
  if (subtotalCents > MAX_ORDER_CENTS) {
    return reply(400, { error: `Order subtotal must be at most ${fromCents(MAX_ORDER_CENTS).toFixed(2)}` });
  }

  // Discount codes are checked after items and stock, which keep their responses
  // (DC-R15); a refusal changes nothing. DC-R13: omitted or null means no code;
  // anything else must be a non-empty string. Code review finding CR-03: this check
  // used to run before the items, so a bad code hid an unknown product's 404.
  if (discount_code !== null && (typeof discount_code !== 'string' || discount_code.trim() === '')) {
    return reply(400, { error: 'discount_code must be a non-empty string or null' });
  }
  let code: string | null = null;
  let discountCents = 0;
  if (discount_code !== null) {
    const result = await checkDiscount(discount_code, currentUser(req).id, subtotalCents, tx);
    if ('error' in result) return reply(422, { error: result.error });
    code = result.code;
    discountCents = result.discountCents;
  }

  const order = await tx.orders.insert({
    user_id:       currentUser(req).id,
    status:        'pending',
    subtotal:      fromCents(subtotalCents),
    discount_code: code,
    discount:      fromCents(discountCents),
    total:         fromCents(subtotalCents - discountCents),
    items:         resolvedItems,
  });

  for (const { product, quantity } of requested.values()) {
    await tx.products.update(product.id, { stock: product.stock - quantity });
  }

  return reply(201, order);
}

router.patch('/:id/status', handle(async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  send(res, await store.transaction((tx) => changeStatus(tx, req, status)));
}));

// With the order locked, so two cancels at once can't both see it pending and
// return its stock twice.
async function changeStatus(tx: store.Tables, req: Request, status: string): Promise<Reply> {
  const order = await visibleOrder(req, tx, { lock: true });
  if (!order) return reply(404, { error: `Order ${req.params.id} not found` });
  if (!isAdmin(req) && !CUSTOMER_MOVES.includes(status)) {
    return reply(403, { error: 'Customers can only cancel an order' });
  }
  if (!NEXT[order.status]?.includes(status)) {
    return reply(409, { error: `Cannot change order status from ${order.status} to ${status}` });
  }
  // Cancelling returns the stock the order took (it used to stay taken), for
  // products that still exist.
  if (status === 'cancelled') {
    await lockProducts(tx, order.items.map((i) => i.product_id));
    for (const { product_id, quantity } of order.items) {
      const product = await tx.products.findById(product_id);
      if (product) await tx.products.update(product_id, { stock: product.stock + quantity });
    }
  }
  return reply(200, await tx.orders.update(order.id, { status }));
}

export default router;
