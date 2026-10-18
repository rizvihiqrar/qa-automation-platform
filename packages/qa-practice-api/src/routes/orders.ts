import { Router } from 'express';
import * as store from '../db/store.ts';
import type { Request } from 'express';
import { requireAuth, currentUser, isAdmin } from '../middleware/auth.ts';
import { checkDiscount } from './discounts.ts';
import { toCents, fromCents } from '../money.ts';

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
function visibleOrder(req: Request): store.Order | null {
  const order = store.orders.findById(String(req.params.id));
  return order && (isAdmin(req) || order.user_id === currentUser(req).id) ? order : null;
}

router.use(requireAuth);

router.get('/', (req, res) => {
  const filter = isAdmin(req) ? {} : { user_id: currentUser(req).id };
  const { data } = store.orders.findAll(filter, { page: 1, limit: 1000 });
  res.json(data.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

router.get('/:id', (req, res) => {
  const order = visibleOrder(req);
  if (!order) return res.status(404).json({ error: `Order ${req.params.id} not found` });
  res.json(order);
});

router.post('/', (req, res) => {
  const { items, discount_code = null } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
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
      return res.status(400).json({ error: 'Each item needs product_id and a whole-number quantity >= 1' });
    }
    const product = store.products.findById(product_id);
    if (!product) return res.status(404).json({ error: `Product ${product_id} not found` });
    const wanted = (requested.get(product.id)?.quantity ?? 0) + quantity;
    if (product.stock < wanted) {
      return res.status(400).json({
        error: `Insufficient stock for product ${product_id} (available: ${product.stock})`,
      });
    }
    requested.set(product.id, { product, quantity: wanted });
    subtotalCents += toCents(product.price) * quantity;
    resolvedItems.push({ product_id: product.id, name: product.name, price: product.price, quantity });
  }

  // Discount codes are checked after items and stock, which keep their responses
  // (DC-R15); a refusal changes nothing. DC-R13: omitted or null means no code;
  // anything else must be a non-empty string. Code review finding CR-03: this check
  // used to run before the items, so a bad code hid an unknown product's 404.
  if (discount_code !== null && (typeof discount_code !== 'string' || discount_code.trim() === '')) {
    return res.status(400).json({ error: 'discount_code must be a non-empty string or null' });
  }
  let code: string | null = null;
  let discountCents = 0;
  if (discount_code !== null) {
    const result = checkDiscount(discount_code, currentUser(req).id, subtotalCents);
    if ('error' in result) return res.status(422).json({ error: result.error });
    code = result.code;
    discountCents = result.discountCents;
  }

  const order = store.orders.insert({
    user_id:       currentUser(req).id,
    status:        'pending',
    subtotal:      fromCents(subtotalCents),
    discount_code: code,
    discount:      fromCents(discountCents),
    total:         fromCents(subtotalCents - discountCents),
    items:         resolvedItems,
  });

  for (const { product, quantity } of requested.values()) {
    store.products.update(product.id, { stock: product.stock - quantity });
  }

  res.status(201).json(order);
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  const order = visibleOrder(req);
  if (!order) return res.status(404).json({ error: `Order ${req.params.id} not found` });
  if (!isAdmin(req) && !CUSTOMER_MOVES.includes(status)) {
    return res.status(403).json({ error: 'Customers can only cancel an order' });
  }
  if (!NEXT[order.status]?.includes(status)) {
    return res.status(409).json({ error: `Cannot change order status from ${order.status} to ${status}` });
  }
  // Cancelling returns the stock the order took (it used to stay taken), for
  // products that still exist.
  if (status === 'cancelled') {
    for (const { product_id, quantity } of order.items) {
      const product = store.products.findById(product_id);
      if (product) store.products.update(product_id, { stock: product.stock + quantity });
    }
  }
  res.json(store.orders.update(req.params.id, { status }));
});

export default router;
