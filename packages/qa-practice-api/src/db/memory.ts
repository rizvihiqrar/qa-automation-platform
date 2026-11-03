// The in-memory store: each table is a Map in this process, gone when it stops.
// It has the promise-based shape of types.ts, so a database store can replace it
// without changing the routes.
import { toId, UniqueViolation } from './types.ts';
import type { Row, Id, Table, Tables, Store, FindOptions, Page } from './types.ts';

class MemoryTable<T extends Row> implements Table<T> {
  #rows = new Map<number, T>();
  #nextId = 1;
  // Columns no two rows may share, like a unique index in Postgres.
  #unique: (keyof T)[];

  constructor(unique: (keyof T)[] = []) {
    this.#unique = unique;
  }

  #checkUnique(row: T): void {
    for (const column of this.#unique) {
      for (const other of this.#rows.values()) {
        if (other.id !== row.id && other[column] === row[column]) throw new UniqueViolation(String(column));
      }
    }
  }

  async insert(record: Omit<T, keyof Row>): Promise<T> {
    const row = { id: this.#nextId, created_at: new Date().toISOString(), ...record } as T;
    this.#checkUnique(row);
    this.#nextId++;
    this.#rows.set(row.id, { ...row });
    return { ...row };
  }

  // `lock` has nothing to do here: transactions already run one at a time.
  async findById(id: Id, _options?: FindOptions): Promise<T | null> {
    const row = this.#rows.get(toId(id));
    return row ? { ...row } : null;
  }

  async findOne(filter: Partial<T>, _options?: FindOptions): Promise<T | null> {
    for (const row of this.#rows.values()) {
      if (matches(row, filter)) return { ...row };
    }
    return null;
  }

  async findAll(filter: Partial<T> = {}, { page = 1, limit = 10 } = {}): Promise<Page<T>> {
    let rows  = [...this.#rows.values()].filter(r => matches(r, filter));
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    rows = rows.slice((page - 1) * limit, page * limit);
    return { data: rows.map(r => ({ ...r })), total, pages };
  }

  // Undefined values in `changes` leave the field as it was.
  async update(id: Id, changes: Partial<Omit<T, keyof Row>>): Promise<T | null> {
    const row = this.#rows.get(toId(id));
    if (!row) return null;
    const updated: T = { ...row };
    for (const [k, v] of Object.entries(changes)) {
      if (v !== undefined) (updated as Record<string, unknown>)[k] = v;
    }
    this.#checkUnique(updated);
    this.#rows.set(row.id, updated);
    return { ...updated };
  }

  async delete(id: Id): Promise<boolean> {
    return this.#rows.delete(toId(id));
  }
}

function matches<T extends Row>(row: T, filter: Partial<T>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if ((row as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

export function memoryStore(): Store {
  const tables: Tables = {
    users:     new MemoryTable(['email']),
    products:  new MemoryTable(),
    orders:    new MemoryTable(),
    discounts: new MemoryTable(['code']),
  };
  // Transactions queue up and run one at a time, so no two orders can read the same
  // stock between their awaits. Unlike Postgres, nothing is undone if `work` throws
  // halfway: the routes check everything before their first write.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    ...tables,
    transaction<R>(work: (tx: Tables) => Promise<R>): Promise<R> {
      const run = queue.then(() => work(tables));
      queue = run.catch(() => {});
      return run;
    },
    async ping() {},
    async close() {},
  };
}
