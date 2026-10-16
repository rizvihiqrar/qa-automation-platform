import { Router } from 'express';
import * as store from '../db/store.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const filter = req.query.category ? { category: req.query.category } : {};
  const { data, total, pages } = store.products.findAll(filter, { page, limit });
  res.json({ data, page, limit, total, pages });
});

router.get('/:id', (req, res) => {
  const product = store.products.findById(req.params.id);
  if (!product) return res.status(404).json({ error: `Product ${req.params.id} not found` });
  res.json(product);
});

router.post('/', requireAuth, (req, res) => {
  const { name, category, price, stock } = req.body;
  if (!name || !category || price == null) {
    return res.status(400).json({ error: 'name, category, and price are required' });
  }
  if (price < 0) return res.status(400).json({ error: 'price must be non-negative' });
  const product = store.products.insert({
    name,
    category,
    price: parseFloat(price),
    stock: parseInt(stock) || 0,
  });
  res.status(201).json(product);
});

router.put('/:id', requireAuth, (req, res) => {
  if (!store.products.findById(req.params.id)) {
    return res.status(404).json({ error: `Product ${req.params.id} not found` });
  }
  const { name, category, price, stock } = req.body;
  const updated = store.products.update(req.params.id, {
    ...(name     !== undefined && { name }),
    ...(category !== undefined && { category }),
    ...(price    != null       && { price:  parseFloat(price) }),
    ...(stock    != null       && { stock:  parseInt(stock) }),
  });
  res.json(updated);
});

router.delete('/:id', requireAuth, (req, res) => {
  if (!store.products.findById(req.params.id)) {
    return res.status(404).json({ error: `Product ${req.params.id} not found` });
  }
  store.products.delete(req.params.id);
  res.status(204).end();
});

export default router;
