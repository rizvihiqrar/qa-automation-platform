import { Router } from 'express';
import * as store from '../db/store.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const safe = ({ password, ...rest }) => rest;

router.use(requireAuth);

router.get('/', (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const { data, total, pages } = store.users.findAll({}, { page, limit });
  res.json({ data: data.map(safe), page, limit, total, pages });
});

router.get('/:id', (req, res) => {
  const user = store.users.findById(req.params.id);
  if (!user) return res.status(404).json({ error: `User ${req.params.id} not found` });
  res.json(safe(user));
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (req.user.id !== id && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Cannot modify another user's account" });
  }
  if (!store.users.findById(id)) {
    return res.status(404).json({ error: `User ${id} not found` });
  }
  const { name, email } = req.body;
  const updated = store.users.update(id, { name, email });
  res.json(safe(updated));
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (req.user.id !== id && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Cannot delete another user's account" });
  }
  if (!store.users.findById(id)) {
    return res.status(404).json({ error: `User ${id} not found` });
  }
  store.users.delete(id);
  res.status(204).end();
});

export default router;
