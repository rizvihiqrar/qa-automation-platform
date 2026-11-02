// Wraps a store so its transactions and row locks show in the request's trace
// (src/telemetry.ts), the same way for both stores:
//   db.transaction  from the call until the commit or rollback (qa.transaction.outcome)
//   db.lock         one per locked row; how long it lasts is how long the request
//                   waited for another transaction to let go of the row
// On Postgres each SQL statement is a span too, inside these (postgres.ts). In
// memory a lock never waits (transactions run one at a time), so the waiting shows
// at the start of db.transaction instead.
import { inSpan } from '../telemetry.ts';
import type { Row, Table, Tables, Store, FindOptions } from './types.ts';

function tracedTable<T extends Row>(table: Table<T>, name: string, store: string): Table<T> {
  const lock = <R>(what: Record<string, string | number>, find: () => Promise<R>): Promise<R> =>
    inSpan('db.lock', { 'db.collection.name': name, 'qa.store': store, ...what }, find);
  // Each method calls the table's own (the memory tables keep their rows in private
  // fields, which only the table itself can reach).
  return {
    insert:  (record) => table.insert(record),
    findAll: (filter, page) => table.findAll(filter, page),
    update:  (id, changes) => table.update(id, changes),
    delete:  (id) => table.delete(id),
    findById: (id, options?: FindOptions) =>
      options?.lock ? lock({ 'qa.row.id': String(id) }, () => table.findById(id, options)) : table.findById(id, options),
    findOne: (filter, options?: FindOptions) =>
      // The filter's column names only: their values can be an email.
      options?.lock ? lock({ 'qa.row.filter': Object.keys(filter).join(',') }, () => table.findOne(filter, options)) : table.findOne(filter, options),
  };
}

function tracedTables(tables: Tables, store: string): Tables {
  return {
    users:     tracedTable(tables.users, 'users', store),
    products:  tracedTable(tables.products, 'products', store),
    orders:    tracedTable(tables.orders, 'orders', store),
    discounts: tracedTable(tables.discounts, 'discounts', store),
  };
}

export function traced(inner: Store, store: 'postgres' | 'memory'): Store {
  return {
    ...tracedTables(inner, store),
    transaction: (work) => inSpan('db.transaction', { 'qa.store': store }, async (span) => {
      span.setAttribute('qa.transaction.outcome', 'rollback'); // until the commit below
      const result = await inner.transaction((tx) => work(tracedTables(tx, store)));
      span.setAttribute('qa.transaction.outcome', 'commit');
      return result;
    }),
    close: () => inner.close(),
  };
}
