import { Router } from 'express';
import * as store from '../db/store.ts';
import { requireAuth, currentUser } from '../middleware/auth.ts';
import { pagination } from './query.ts';

const router = Router();
const safe = ({ password: _password, ...rest }: store.User) => rest;

router.use(requireAuth);

router.get('/', (req, res) => {
  const { page, limit } = pagination(req.query);
  const { data, total, pages } = store.users.findAll({}, { page, limit });
  res.json({ data: data.map(safe), page, limit, total, pages });
});

router.get('/:id', (req, res) => {
  const user = store.users.findById(req.params.id);
  if (!user) return res.status(404).json({ error: `User ${req.params.id} not found` });
  res.json(safe(user));
});

router.put('/:id', (req, res) => {
  const me = currentUser(req);
  const id = parseInt(req.params.id);
  if (me.id !== id && me.role !== 'admin') {
    return res.status(403).json({ error: "Cannot modify another user's account" });
  }
  const { name, email } = req.body;
  const updated = store.users.update(id, { name, email });
  if (!updated) return res.status(404).json({ error: `User ${id} not found` });
  res.json(safe(updated));
});

router.delete('/:id', (req, res) => {
  const me = currentUser(req);
  const id = parseInt(req.params.id);
  if (me.id !== id && me.role !== 'admin') {
    return res.status(403).json({ error: "Cannot delete another user's account" });
  }
  if (!store.users.delete(id)) {
    return res.status(404).json({ error: `User ${id} not found` });
  }
  res.status(204).end();
});

export default router;
