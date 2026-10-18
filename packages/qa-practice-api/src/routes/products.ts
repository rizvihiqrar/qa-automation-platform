import { Router } from 'express';
import * as store from '../db/store.ts';
import { requireAuth, requireAdmin } from '../middleware/auth.ts';
import { pagination } from './query.ts';
import { isWholeCents } from '../money.ts';

const router = Router();

// Shared by create and update, so both apply the same rules. Update used to skip
// them: PUT accepted price "abc" (stored as null) and negative stock.
// JSON numbers only. parseFloat() let "abc" through as NaN (stored as null), and
// Number() then turned "" into 0 and true into 1 (found by equivalence partitioning,
// docs/test-strategy/test-plan.md).
function parsePrice(price: unknown): number | string {
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return 'price must be a non-negative number';
  // Orders add prices up in whole cents (src/money.ts), which 19.999 can't be:
  // three at 0.333 came to 0.99 (code review finding CR-05).
  return isWholeCents(price) ? price : 'price must be in whole cents (at most two decimals)';
}

function parseStock(stock: unknown): number | string {
  return Number.isInteger(stock) && (stock as number) >= 0
    ? stock as number : 'stock must be a non-negative whole number';
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

// Changing the catalogue is for admins. Any signed-in customer used to be able to
// reprice or delete any product.
router.post('/', requireAuth, requireAdmin, (req, res) => {
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

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
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

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = String(req.params.id);
  if (!store.products.delete(id)) {
    return res.status(404).json({ error: `Product ${id} not found` });
  }
  res.status(204).end();
});

export default router;
