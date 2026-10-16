import express from 'express';
import authRoutes    from './routes/auth.ts';
import userRoutes    from './routes/users.ts';
import productRoutes from './routes/products.ts';
import orderRoutes   from './routes/orders.ts';

const app = express();
app.disable('x-powered-by');
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

export default app;
