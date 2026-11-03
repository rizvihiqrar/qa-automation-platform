// The store the routes use: Postgres when DATABASE_URL is set (postgres.ts),
// otherwise the in-memory one (memory.ts). Types and shared rules are in types.ts.
import { memoryStore } from './memory.ts';
import { traced } from './traced.ts';
import type { Store } from './types.ts';

export * from './types.ts';

const url = process.env.DATABASE_URL;

async function postgresStore(url: string): Promise<Store> {
  // pg is only loaded when it is used, so the in-memory server starts as before.
  const { openPostgres, DEFAULT_TIMEOUTS } = await import('./postgres.ts');
  // Unset or empty: the default. Anything but a whole number of milliseconds stops
  // the start, rather than quietly becoming no timeout at all.
  const ms = (name: string, fallback: number) => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number of milliseconds, not ${raw}`);
    return value;
  };
  return openPostgres(url, {
    connect: ms('DB_CONNECT_TIMEOUT_MS', DEFAULT_TIMEOUTS.connect),
    query: ms('DB_QUERY_TIMEOUT_MS', DEFAULT_TIMEOUTS.query),
    retryDelay: ms('DB_RETRY_DELAY_MS', DEFAULT_TIMEOUTS.retryDelay),
  });
}

// traced.ts adds the transaction and lock spans (src/telemetry.ts).
export const db: Store = url
  ? traced(await postgresStore(url), 'postgres')
  : traced(memoryStore(), 'memory');
export const { users, products, orders, discounts } = db;
export const transaction: Store['transaction'] = (work) => db.transaction(work);
