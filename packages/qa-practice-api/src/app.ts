import express, { type ErrorRequestHandler } from 'express';
import authRoutes    from './routes/auth.ts';
import userRoutes    from './routes/users.ts';
import productRoutes from './routes/products.ts';
import orderRoutes   from './routes/orders.ts';

const app = express();
app.disable('x-powered-by');
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

app.use('/auth',     authRoutes);
app.use('/users',    userRoutes);
app.use('/products', productRoutes);
app.use('/orders',   orderRoutes);

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
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};
app.use(onError);

export default app;
