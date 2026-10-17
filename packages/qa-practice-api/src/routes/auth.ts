import { Router } from 'express';
import * as store from '../db/store.ts';
import { hashPassword, verifyPassword } from '../security/password.ts';
import { signToken, requireAuth, currentUser } from '../middleware/auth.ts';
import { AttemptLimiter } from '../security/rate-limit.ts';

const router = Router();
const safe = ({ password: _password, ...rest }: store.User) => rest;
// A number or object here used to reach the hashing code and come back as a 500.
const allStrings = (...values: unknown[]) => values.every((v) => typeof v === 'string' && v !== '');

// Hashing happens in src/security/password.ts, off the event loop (see there).
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!allStrings(name, email, password)) {
      return res.status(400).json({ error: 'name, email, and password are required strings' });
    }
    if (store.users.findOne({ email })) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    const hash = await hashPassword(password);
    // Re-check: another request may have registered the same email while hashing.
    if (store.users.findOne({ email })) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    const user = store.users.insert({ name, email, password: hash, role: 'user' });
    res.status(201).json({ user: safe(user), token: signToken({ id: user.id, role: user.role }) });
  } catch {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// 5 sign-in attempts per client and email in 15 minutes. Keyed on the pair, so a
// guesser can't lock the owner out from another address. req.ip is the socket
// address: X-Forwarded-For isn't trusted, or a client could pick a new key per request.
export const LOGIN_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginLimiter = new AttemptLimiter(LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!allStrings(email, password)) {
      return res.status(400).json({ error: 'email and password are required strings' });
    }
    const key = `${req.ip}|${email.toLowerCase()}`;
    const attempt = loginLimiter.attempt(key);
    if (!attempt.allowed) {
      res.set('Retry-After', String(attempt.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
    }
    const user = store.users.findOne({ email });
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    loginLimiter.succeeded(key);
    res.json({ user: safe(user), token: signToken({ id: user.id, role: user.role }) });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  const user = store.users.findById(currentUser(req).id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(safe(user));
});

export default router;
