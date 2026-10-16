import { Router } from 'express';
import * as store from '../db/store.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const VALID_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

router.use(requireAuth);

router.get('/', (req, res) => {
  const { data } = store.orders.findAll({ user_id: req.user.id }, { page: 1, limit: 1000 });
  res.json(data.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

router.get('/:id', (req, res) => {
  const order = store.orders.findById(req.params.id);
  if (!order || order.user_id !== req.user.id) {
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
  const resolvedItems = [];

  for (const { product_id, quantity } of items) {
    if (!product_id || !quantity || quantity < 1) {
      return res.status(400).json({ error: 'Each item needs product_id and quantity >= 1' });
    }
    const product = store.products.findById(product_id);
    if (!product) return res.status(404).json({ error: `Product ${product_id} not found` });
    if (product.stock < quantity) {
      return res.status(400).json({
        error: `Insufficient stock for product ${product_id} (available: ${product.stock})`,
      });
    }
    total += product.price * quantity;
    resolvedItems.push({ product_id, name: product.name, price: product.price, quantity });
  }

  const order = store.orders.insert({
    user_id: req.user.id,
    status:  'pending',
    total:   Math.round(total * 100) / 100,
    items:   resolvedItems,
  });

  for (const { product_id, quantity } of items) {
    const p = store.products.findById(product_id);
    store.products.update(product_id, { stock: p.stock - quantity });
  }

  res.status(201).json(order);
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  const order = store.orders.findById(req.params.id);
  if (!order || order.user_id !== req.user.id) {
    return res.status(404).json({ error: `Order ${req.params.id} not found` });
  }
  res.json(store.orders.update(req.params.id, { status }));
});

export default router;
