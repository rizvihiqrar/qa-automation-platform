export interface Row {
  id: number;
  created_at: string;
}

export interface User extends Row {
  name: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
}

export interface Product extends Row {
  name: string;
  category: string;
  price: number;
  stock: number;
}

export interface OrderItem {
  product_id: number;
  name: string;
  price: number;
  quantity: number;
}

export interface Order extends Row {
  user_id: number;
  status: string;
  total: number;
  items: OrderItem[];
}

// Ids arrive as numbers from tokens and as strings from URL params.
type Id = number | string;
const toId = (id: Id): number => (typeof id === 'number' ? id : parseInt(id));

class Table<T extends Row> {
  #rows = new Map<number, T>();
  #nextId = 1;

  insert(record: Omit<T, keyof Row>): T {
    const id  = this.#nextId++;
    const row = { id, created_at: new Date().toISOString(), ...record } as T;
    this.#rows.set(id, { ...row });
    return { ...row };
  }

  findById(id: Id): T | null {
    const row = this.#rows.get(toId(id));
    return row ? { ...row } : null;
  }

  findOne(filter: Partial<T>): T | null {
    for (const row of this.#rows.values()) {
      if (matches(row, filter)) return { ...row };
    }
    return null;
  }

  findAll(filter: Partial<T> = {}, { page = 1, limit = 10 } = {}): { data: T[]; total: number; pages: number } {
    let rows  = [...this.#rows.values()].filter(r => matches(r, filter));
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    rows = rows.slice((page - 1) * limit, page * limit);
    return { data: rows.map(r => ({ ...r })), total, pages };
  }

  // Undefined values in `changes` leave the field as it was.
  update(id: Id, changes: Partial<Omit<T, keyof Row>>): T | null {
    const row = this.#rows.get(toId(id));
    if (!row) return null;
    const updated: T = { ...row };
    for (const [k, v] of Object.entries(changes)) {
      if (v !== undefined) (updated as Record<string, unknown>)[k] = v;
    }
    this.#rows.set(toId(id), updated);
    return { ...updated };
  }

  delete(id: Id): boolean {
    return this.#rows.delete(toId(id));
  }
}

function matches<T extends Row>(row: T, filter: Partial<T>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if ((row as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

export const users    = new Table<User>();
export const products = new Table<Product>();
export const orders   = new Table<Order>();
