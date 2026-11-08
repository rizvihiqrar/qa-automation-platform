import express, { type ErrorRequestHandler } from 'express';
import { trace } from '@opentelemetry/api';
import { tracing } from './middleware/tracing.ts';
import { handle } from './middleware/handle.ts';
import { db, DatabaseUnavailable } from './db/store.ts';
import authRoutes    from './routes/auth.ts';
import userRoutes    from './routes/users.ts';
import productRoutes from './routes/products.ts';
import orderRoutes   from './routes/orders.ts';
import discountRoutes from './routes/discounts.ts';
import uploadRoutes  from './routes/uploads.ts';

const app = express();
app.disable('x-powered-by');
app.use(tracing); // first, so every response has a span (src/middleware/tracing.ts)
// Found by the ZAP scan (zap/rules.tsv), on every response including errors:
// nosniff stops a browser reading a JSON body as HTML or script, and
// Cross-Origin-Resource-Policy stops other sites loading responses into their pages.
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
  next();
});
app.use(express.json());

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);
// /health says the process is up; /health/ready also asks the store, so a load
// balancer can stop sending requests while the database is down (a 503 then).
app.get('/health/ready', handle(async (_req, res) => {
  await db.ping();
  res.json({ status: 'ready' });
}));

app.use('/auth',     authRoutes);
app.use('/users',    userRoutes);
app.use('/products', productRoutes);
app.use('/orders',   orderRoutes);
app.use('/discounts', discountRoutes);
app.use('/uploads',  uploadRoutes);

app.use((req, res) =>
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
);

// Without this, Express answers a malformed JSON body (400) or a thrown error (500)
// with an HTML page, breaking the `{ error }` contract every other response keeps.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  // A body over express.json's 100 kb limit is the client's mistake, not a server fault (it was a 500).
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large' });
    return;
  }
  // Day 51: the database didn't answer in time (src/db/postgres.ts). A short reply
  // without the driver's message. It says try again only when nothing was saved:
  // a write cut after it was sent may have been, and a resend could be a duplicate.
  if (err instanceof DatabaseUnavailable) {
    console.error(err.message);
    trace.getActiveSpan()?.recordException(err);
    if (err.maybeSaved) {
      res.status(503).json({ error: 'Database unavailable: the change may have been saved. Check before sending it again.' });
    } else {
      res.set('Retry-After', '2').status(503).json({ error: 'Database unavailable' });
    }
    return;
  }
  console.error(err);
  trace.getActiveSpan()?.recordException(err as Error); // the request's span (500 marks it failed)
  res.status(500).json({ error: 'Internal server error' });
};
app.use(onError);

export default app;
