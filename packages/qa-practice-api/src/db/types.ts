// What every store offers the routes. All calls return promises, because a
// database answers over a connection; the in-memory store (memory.ts) answers at
// once but keeps the same shape, so a database store can take its place.

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
  subtotal: number;
  discount_code: string | null;
  discount: number;
  total: number;
  items: OrderItem[];
}

export interface Discount extends Row {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  expires_at: string | null;
  max_uses: number | null;
  min_subtotal: number;
  active: boolean;
}

// Ids arrive as numbers from tokens and as strings from URL params.
export type Id = number | string;
export const toId = (id: Id): number => (typeof id === 'number' ? id : parseInt(id));

export interface Page<T> {
  data: T[];
  total: number;
  pages: number;
}

// lock: inside a transaction, hold the row until it ends, so another transaction
// that wants it waits (SELECT ... FOR UPDATE in Postgres).
export interface FindOptions {
  lock?: boolean;
}

export interface Table<T extends Row> {
  insert(record: Omit<T, keyof Row>): Promise<T>;
  findById(id: Id, options?: FindOptions): Promise<T | null>;
  findOne(filter: Partial<T>, options?: FindOptions): Promise<T | null>;
  findAll(filter?: Partial<T>, page?: { page?: number; limit?: number }): Promise<Page<T>>;
  update(id: Id, changes: Partial<Omit<T, keyof Row>>): Promise<T | null>;
  delete(id: Id): Promise<boolean>;
}

export interface Tables {
  users: Table<User>;
  products: Table<Product>;
  orders: Table<Order>;
  discounts: Table<Discount>;
}

export interface Store extends Tables {
  // Runs `work` all or nothing: other transactions can't see its writes until it
  // ends, and rows it locked stay locked until then.
  transaction<R>(work: (tx: Tables) => Promise<R>): Promise<R>;
  // Resolves when the store answers (GET /health/ready).
  ping(): Promise<void>;
  close(): Promise<void>;
}

// The database could not be reached in time (Day 51); app.ts answers 503.
//   connect  no connection could be made: nothing was sent
//   lost     the connection broke during a statement: a write may have been saved
//   timeout  no answer within the query timeout
// maybeSaved: a write or COMMIT was sent and no answer came, so it may have been
// saved; the 503 then doesn't invite the caller to send it again.
export class DatabaseUnavailable extends Error {
  readonly reason: 'connect' | 'lost' | 'timeout';
  readonly maybeSaved: boolean;
  constructor(reason: 'connect' | 'lost' | 'timeout', cause: unknown, maybeSaved = false) {
    super(`database unavailable (${reason}): ${(cause as Error)?.message ?? cause}`, { cause });
    this.reason = reason;
    this.maybeSaved = maybeSaved;
  }
}

// A second user with the same email, or a second discount with the same code.
export class UniqueViolation extends Error {
  readonly column: string;
  constructor(column: string) {
    super(`${column} already exists`);
    this.column = column;
  }
}
