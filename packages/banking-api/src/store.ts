import { Ledger, type Store } from './ledger.ts';

// Which store a server or tool uses, from its environment:
//   DATABASE_URL     a Postgres connection string: the ledger on Postgres (src/postgres.ts)
//   DATABASE_SCHEMA  the Postgres schema for its tables (default public); tests give each server one
//   DATABASE_PATH    otherwise, a SQLite file (default: in memory)
// Postgres is loaded only when it is asked for, so the SQLite server starts as before and
// needs no package from npm.
export interface StoreConfig {
  DATABASE_URL?: string;
  DATABASE_SCHEMA?: string;
  DATABASE_PATH?: string;
}

export async function openStore(env: StoreConfig = process.env, now?: () => string): Promise<Store> {
  if (env.DATABASE_URL) {
    const { PostgresLedger } = await import('./postgres.ts');
    return PostgresLedger.open(env.DATABASE_URL, { schema: env.DATABASE_SCHEMA || 'public', now });
  }
  return new Ledger(env.DATABASE_PATH || ':memory:', now);
}

// What a log line says the ledger is: never the connection string, which may hold a password.
export function describeStore(env: StoreConfig = process.env): string {
  if (env.DATABASE_URL) {
    const schema = `schema ${env.DATABASE_SCHEMA || 'public'}`;
    // pg takes connection strings that are not URLs (a socket path, an unencoded password), so
    // a string this can't read is named, not parsed: the log line must never stop the server.
    try {
      const url = new URL(env.DATABASE_URL);
      return `postgres ${url.hostname}:${url.port || 5432}${url.pathname}, ${schema}`;
    } catch {
      return `postgres (DATABASE_URL), ${schema}`;
    }
  }
  return env.DATABASE_PATH ?? 'in memory';
}
