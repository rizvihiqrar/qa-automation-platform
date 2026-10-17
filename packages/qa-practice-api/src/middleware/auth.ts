import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import * as store from '../db/store.ts';
import type { User } from '../db/store.ts';

// The fallback used to be a fixed string, published in this repository, so anyone
// could sign a token for any user id. A random one per process costs nothing here:
// the store is in memory, so no account outlives a restart for its token to need.
const SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');

export interface TokenPayload {
  id: number;
  role: User['role'];
}

// requireAuth stores the signed-in user here for the route handlers.
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  let payload: TokenPayload;
  try {
    payload = jwt.verify(header.slice(7), SECRET, { algorithms: ['HS256'] }) as TokenPayload;
  } catch {
    res.status(401).json({ error: 'Token is invalid or expired' });
    return;
  }
  // A valid signature only proves the account existed when the token was issued.
  // Checking the store stops a deleted account's token from working for the rest
  // of its hour, and takes the role from the account rather than the token.
  const user = store.users.findById(payload.id);
  if (!user) {
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }
  req.user = { id: user.id, role: user.role };
  next();
}

// After requireAuth, on routes only an admin may use.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (currentUser(req).role !== 'admin') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  next();
}

export const isAdmin = (req: Request): boolean => currentUser(req).role === 'admin';

// For handlers behind requireAuth: the signed-in user, or an error if the route
// was wired without the middleware.
export function currentUser(req: Request): TokenPayload {
  if (!req.user) throw new Error('currentUser() called on a route without requireAuth');
  return req.user;
}
