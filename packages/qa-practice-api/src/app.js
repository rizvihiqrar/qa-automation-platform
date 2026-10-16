import express from 'express';
import authRoutes    from './routes/auth.js';
import userRoutes    from './routes/users.js';
import productRoutes from './routes/products.js';
import orderRoutes   from './routes/orders.js';

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
