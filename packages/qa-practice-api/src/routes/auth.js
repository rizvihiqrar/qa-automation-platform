import { Router } from 'express';
import bcrypt from 'bcryptjs';
import * as store from '../db/store.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();
const safe = ({ password, ...rest }) => rest;

router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (store.users.findOne({ email })) {
    return res.status(409).json({ error: 'Email already in use' });
  }
  const user = store.users.insert({
    name,
    email,
    password: bcrypt.hashSync(password, 10),
    role: 'user',
  });
  res.status(201).json({ user: safe(user), token: signToken({ id: user.id, role: user.role }) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const user = store.users.findOne({ email });
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ user: safe(user), token: signToken({ id: user.id, role: user.role }) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = store.users.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(safe(user));
});

export default router;
