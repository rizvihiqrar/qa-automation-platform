// The store the routes use. Types and the shared rules are in types.ts.
import { memoryStore } from './memory.ts';
import type { Store } from './types.ts';

export * from './types.ts';

export const db: Store = memoryStore();
export const { users, products, orders, discounts } = db;
export const transaction: Store['transaction'] = (work) => db.transaction(work);
