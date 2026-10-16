import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { User } from '../db/store.ts';

const SECRET = process.env.JWT_SECRET || 'qa-practice-secret-change-in-prod';

export interface TokenPayload {
  id: number;
  role: User['role'];
}

// requireAuth stores the verified token here for the route handlers.
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  try {
    req.user = jwt.verify(header.slice(7), SECRET) as TokenPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Token is invalid or expired' });
  }
}

// For handlers behind requireAuth: the signed-in user, or an error if the route
// was wired without the middleware.
export function currentUser(req: Request): TokenPayload {
  if (!req.user) throw new Error('currentUser() called on a route without requireAuth');
  return req.user;
}
