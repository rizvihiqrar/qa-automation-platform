import { Router } from 'express';
import * as store from '../db/store.ts';
import { requireAuth, currentUser } from '../middleware/auth.ts';

const router = Router();
const VALID_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

router.use(requireAuth);

router.get('/', (req, res) => {
  const { data } = store.orders.findAll({ user_id: currentUser(req).id }, { page: 1, limit: 1000 });
  res.json(data.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

router.get('/:id', (req, res) => {
  const order = store.orders.findById(req.params.id);
  if (!order || order.user_id !== currentUser(req).id) {
    return res.status(404).json({ error: `Order ${req.params.id} not found` });
  }
  res.json(order);
});

router.post('/', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  let total = 0;
  const resolvedItems: store.OrderItem[] = [];
  // Quantity requested per product across all lines. Stock used to be checked
  // line by line, so two lines for the same product could each pass and oversell it.
  const requested = new Map<number, { product: store.Product; quantity: number }>();

  for (const { product_id, quantity } of items) {
    if (!product_id || !quantity || quantity < 1) {
      return res.status(400).json({ error: 'Each item needs product_id and quantity >= 1' });
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
    total += product.price * quantity;
    resolvedItems.push({ product_id: product.id, name: product.name, price: product.price, quantity });
  }

  const order = store.orders.insert({
    user_id: currentUser(req).id,
    status:  'pending',
    total:   Math.round(total * 100) / 100,
    items:   resolvedItems,
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
  const order = store.orders.findById(req.params.id);
  if (!order || order.user_id !== currentUser(req).id) {
    return res.status(404).json({ error: `Order ${req.params.id} not found` });
  }
  res.json(store.orders.update(req.params.id, { status }));
});

export default router;
