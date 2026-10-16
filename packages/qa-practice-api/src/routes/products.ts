import { Router } from 'express';
import * as store from '../db/store.ts';
import { requireAuth } from '../middleware/auth.ts';
import { pagination } from './query.ts';

const router = Router();

// Shared by create and update, so both apply the same rules. Update used to skip
// them: PUT accepted price "abc" (stored as null) and negative stock.
// Number(), not parseFloat(): "abc" used to slip through as NaN and be stored as null.
function parsePrice(price: unknown): number | string {
  const value = Number(price);
  return Number.isFinite(value) && value >= 0 ? value : 'price must be a non-negative number';
}

function parseStock(stock: unknown): number | string {
  const value = Number(stock);
  return Number.isInteger(value) && value >= 0 ? value : 'stock must be a non-negative whole number';
}

router.get('/', (req, res) => {
  const { page, limit } = pagination(req.query);
  const filter = typeof req.query.category === 'string' ? { category: req.query.category } : {};
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
  const priceValue = parsePrice(price);
  if (typeof priceValue === 'string') return res.status(400).json({ error: priceValue });
  const stockValue = stock == null ? 0 : parseStock(stock);
  if (typeof stockValue === 'string') return res.status(400).json({ error: stockValue });

  const product = store.products.insert({ name, category, price: priceValue, stock: stockValue });
  res.status(201).json(product);
});

router.put('/:id', requireAuth, (req, res) => {
  const id = String(req.params.id);
  if (!store.products.findById(id)) {
    return res.status(404).json({ error: `Product ${id} not found` });
  }
  const { name, category, price, stock } = req.body;
  const priceValue = price == null ? undefined : parsePrice(price);
  if (typeof priceValue === 'string') return res.status(400).json({ error: priceValue });
  const stockValue = stock == null ? undefined : parseStock(stock);
  if (typeof stockValue === 'string') return res.status(400).json({ error: stockValue });

  const updated = store.products.update(id, { name, category, price: priceValue, stock: stockValue });
  res.json(updated);
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = String(req.params.id);
  if (!store.products.delete(id)) {
    return res.status(404).json({ error: `Product ${id} not found` });
  }
  res.status(204).end();
});

export default router;
