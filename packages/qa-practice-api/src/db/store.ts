// The store the routes use: Postgres when DATABASE_URL is set (postgres.ts),
// otherwise the in-memory one (memory.ts). Types and shared rules are in types.ts.
import { memoryStore } from './memory.ts';
import { traced } from './traced.ts';
import type { Store } from './types.ts';

export * from './types.ts';

const url = process.env.DATABASE_URL;
// pg is only loaded when it is used, so the in-memory server starts as before.
// traced.ts adds the transaction and lock spans (src/telemetry.ts).
export const db: Store = url
  ? traced(await (await import('./postgres.ts')).openPostgres(url), 'postgres')
  : traced(memoryStore(), 'memory');
export const { users, products, orders, discounts } = db;
export const transaction: Store['transaction'] = (work) => db.transaction(work);
