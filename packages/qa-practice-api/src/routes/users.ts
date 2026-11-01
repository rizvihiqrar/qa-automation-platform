import { Router } from 'express';
import * as store from '../db/store.ts';
import { requireAuth, requireAdmin, currentUser, isAdmin } from '../middleware/auth.ts';
import { pagination } from './query.ts';
import { handle } from '../middleware/handle.ts';

const router = Router();
const safe = ({ password: _password, ...rest }: store.User) => rest;

router.use(requireAuth);

// Admins only. The list used to give any signed-in user every account's name and email.
router.get('/', requireAdmin, handle(async (req, res) => {
  const { page, limit } = pagination(req.query);
  const { data, total, pages } = await store.users.findAll({}, { page, limit });
  res.json({ data: data.map(safe), page, limit, total, pages });
}));

// Own account or admin, like PUT and DELETE, and 403 before the lookup so a
// customer can't tell which ids exist.
router.get('/:id', handle(async (req, res) => {
  if (currentUser(req).id !== parseInt(String(req.params.id)) && !isAdmin(req)) {
    return res.status(403).json({ error: "Cannot read another user's account" });
  }
  const user = await store.users.findById(String(req.params.id));
  if (!user) return res.status(404).json({ error: `User ${req.params.id} not found` });
  res.json(safe(user));
}));

router.put('/:id', handle(async (req, res) => {
  const me = currentUser(req);
  const id = parseInt(String(req.params.id));
  if (me.id !== id && me.role !== 'admin') {
    return res.status(403).json({ error: "Cannot modify another user's account" });
  }
  if (!await store.users.findById(id)) return res.status(404).json({ error: `User ${id} not found` });
  const { name, email } = req.body;
  for (const [field, value] of Object.entries({ name, email })) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      return res.status(400).json({ error: `${field} must be a non-empty string` });
    }
  }
  // Register refused a taken email but update didn't, so two accounts could share
  // one and login picked whichever was created first (found by a decision table).
  const owner = email === undefined ? null : await store.users.findOne({ email });
  if (owner && owner.id !== id) return res.status(409).json({ error: 'Email already in use' });
  // Another request can take the email between that check and this write; the
  // store's unique rule on email then refuses it.
  // A delete between the lookup above and this write leaves nothing to update.
  try {
    const updated = await store.users.update(id, { name, email });
    if (!updated) return res.status(404).json({ error: `User ${id} not found` });
    res.json(safe(updated));
  } catch (err) {
    if (err instanceof store.UniqueViolation) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
}));

router.delete('/:id', handle(async (req, res) => {
  const me = currentUser(req);
  const id = parseInt(String(req.params.id));
  if (me.id !== id && me.role !== 'admin') {
    return res.status(403).json({ error: "Cannot delete another user's account" });
  }
  if (!await store.users.delete(id)) {
    return res.status(404).json({ error: `User ${id} not found` });
  }
  res.status(204).end();
}));

export default router;
