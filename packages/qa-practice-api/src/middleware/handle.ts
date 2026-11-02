import type { Request, Response, NextFunction } from 'express';
import { rememberRoute } from './tracing.ts';

// Express 4 ignores a promise a handler returns, so an error thrown after an await
// left the request hanging. This passes it on to the JSON error handler in app.ts,
// noting the route first for the request's span (tracing.ts).
export const handle =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err) => {
      rememberRoute(req, res);
      next(err);
    });
  };

// A response worked out inside a transaction. The route sends it only after the
// transaction ends: sent from inside, a client could read the old data before the
// commit, or get a success that was then rolled back.
export interface Reply {
  status: number;
  body: unknown;
}
export const reply = (status: number, body: unknown): Reply => ({ status, body });
export const send = (res: Response, { status, body }: Reply): void => {
  res.status(status).json(body);
};
