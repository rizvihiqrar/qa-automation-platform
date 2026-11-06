import { randomBytes } from 'node:crypto';
import { priceOrder, type Fulfilment, type Totals } from './money.ts';
import { MockProvider, ProviderTimeout } from './provider.ts';
import { allowedNext, type Status } from './status.ts';

// The truck's rules, in memory: menu, accounts, orders and money. Nothing here knows
// about HTTP except that a refusal carries a status and a code.

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type Role = 'customer' | 'staff';
export interface User { id: number; email: string; password: string; role: Role }
export interface MenuItem { id: string; name: string; price_cents: number; sold_out: boolean }
export interface OrderLine { item_id: string; name: string; quantity: number; unit_price_cents: number; line_cents: number }
export interface Order extends Totals {
  id: number;
  customer_id: number;
  status: Status;
  fulfilment: Fulfilment;
  address: string | null;
  items: OrderLine[];
  paid_cents: number;
  refunded_cents: number;
  driver_steps: number;
}
export interface Payment {
  id: number;
  order_id: number;
  amount_cents: number;
  status: 'approved';
  card_last4: string;
  duplicates_voided: number;
  order_status: Status;
}
export interface Refund { id: number; order_id: number; amount_cents: number; refunded_cents: number; refundable_cents: number }
export type Replay = [status: number, payload: unknown];
export interface PayResult { reply: Replay; replayed: boolean }

export const MAX_QUANTITY = 20;
export const ROUTE_STEPS = 10;
const MINUTES_PER_STEP = 2;

const USERS: readonly User[] = [
  { id: 1, email: 'ava@foodtruck.test', password: 'ava-demo-pass', role: 'customer' },
  { id: 2, email: 'ben@foodtruck.test', password: 'ben-demo-pass', role: 'customer' },
  { id: 3, email: 'sam@foodtruck.test', password: 'sam-demo-pass', role: 'staff' },
];

const MENU: readonly MenuItem[] = [
  { id: 'taco', name: 'Street taco', price_cents: 495, sold_out: false },
  { id: 'burrito', name: 'Loaded burrito', price_cents: 1295, sold_out: false },
  { id: 'poutine', name: 'Poutine', price_cents: 899, sold_out: false },
  { id: 'churro', name: 'Churro', price_cents: 350, sold_out: false },
  { id: 'sweet-tea', name: 'Sweet tea', price_cents: 250, sold_out: false },
];

const isCents = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

interface OrderRequest { items: unknown; fulfilment: unknown; address: unknown }
interface Remembered { fingerprint: string; reply: Promise<Replay> }

export class Shop {
  readonly provider: MockProvider;
  private readonly menu = new Map<string, MenuItem>(MENU.map((item) => [item.id, { ...item }]));
  private readonly tokens = new Map<string, User>();
  private readonly orders = new Map<number, Order>();
  private readonly remembered = new Map<string, Remembered>();
  private readonly paying = new Set<number>();
  private payments = 0;
  private refunds = 0;

  constructor(provider = new MockProvider()) {
    this.provider = provider;
  }

  login(email: unknown, password: unknown): { token: string; role: Role } {
    const user = USERS.find((candidate) => candidate.email === email && candidate.password === password);
    if (!user) throw new HttpError(401, 'invalid_credentials', 'wrong email or password');
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, user);
    return { token, role: user.role };
  }

  userFor(token: string): User | undefined {
    return this.tokens.get(token);
  }

  listMenu(): MenuItem[] {
    return [...this.menu.values()];
  }

  setSoldOut(id: string, soldOut: unknown): MenuItem {
    const item = this.menu.get(id);
    if (!item) throw new HttpError(404, 'not_found', `no menu item ${id}`);
    if (typeof soldOut !== 'boolean') throw new HttpError(400, 'invalid_sold_out', 'sold_out must be true or false');
    item.sold_out = soldOut;
    return item;
  }

  placeOrder(user: User, { items, fulfilment, address }: OrderRequest): Order {
    if (fulfilment !== 'pickup' && fulfilment !== 'delivery') throw new HttpError(400, 'invalid_fulfilment', 'fulfilment must be pickup or delivery');
    if (fulfilment === 'delivery' && (typeof address !== 'string' || address.trim() === '')) throw new HttpError(400, 'address_required', 'a delivery needs an address');
    if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'empty_order', 'an order needs at least one item');

    const wanted = new Map<string, number>();
    for (const line of items as { item_id?: unknown; quantity?: unknown }[]) {
      const { item_id: id, quantity } = line ?? {};
      if (typeof id !== 'string' || !this.menu.has(id)) throw new HttpError(400, 'unknown_item', `no menu item ${String(id)}`);
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'invalid_quantity', `quantity must be a whole number from 1 to ${MAX_QUANTITY}`);
      wanted.set(id, (wanted.get(id) ?? 0) + quantity);
    }

    const lines: OrderLine[] = [];
    for (const [id, quantity] of wanted) {
      const item = this.menu.get(id)!;
      if (quantity > MAX_QUANTITY) throw new HttpError(400, 'invalid_quantity', `quantity must be a whole number from 1 to ${MAX_QUANTITY}`);
      if (item.sold_out) throw new HttpError(409, 'sold_out', `${item.name} is sold out`);
      lines.push({ item_id: id, name: item.name, quantity, unit_price_cents: item.price_cents, line_cents: quantity * item.price_cents });
    }

    const order: Order = {
      id: this.orders.size + 1,
      customer_id: user.id,
      status: 'placed',
      fulfilment,
      address: fulfilment === 'delivery' ? (address as string).trim() : null,
      items: lines,
      ...priceOrder(lines, fulfilment),
      paid_cents: 0,
      refunded_cents: 0,
      driver_steps: 0,
    };
    this.orders.set(order.id, order);
    return order;
  }

  // Customers see only their own orders: 404, not 403, so an id reveals nothing.
  orderFor(user: User, id: number): Order {
    const order = this.orders.get(id);
    if (!order || (user.role !== 'staff' && order.customer_id !== user.id)) throw new HttpError(404, 'not_found', `no order ${id}`);
    return order;
  }

  // The key belongs to the person who sent it. A result is remembered from the moment
  // the attempt starts, so a second request with the same key waits for the first
  // instead of charging again. A timeout is forgotten: nobody knows yet how it ended,
  // so the same key must be able to try again.
  async pay(user: User, order: Order, key: string, card: string): Promise<PayResult> {
    const scoped = `${user.id}:${key}`;
    const fingerprint = `${order.id}:${card}`;
    const earlier = this.remembered.get(scoped);
    if (earlier) {
      if (earlier.fingerprint !== fingerprint) throw new HttpError(422, 'idempotency_key_reused', 'this Idempotency-Key was used with a different request');
      return { reply: await earlier.reply, replayed: true };
    }
    if (this.paying.has(order.id)) throw new HttpError(409, 'payment_in_progress', 'another payment for this order is still running');
    this.refuseMove(order, 'paid');

    this.paying.add(order.id);
    const reply = this.chargeOrder(order, card).finally(() => this.paying.delete(order.id));
    this.remembered.set(scoped, { fingerprint, reply });
    return { reply: await reply.catch((err: unknown) => {
      this.remembered.delete(scoped);
      throw err;
    }), replayed: false };
  }

  private async chargeOrder(order: Order, card: string): Promise<Replay> {
    let result;
    try {
      result = await this.provider.charge(String(order.id), card, order.total_cents);
    } catch (err) {
      if (err instanceof ProviderTimeout) throw new HttpError(504, 'provider_timeout', 'the payment provider did not answer; retry with the same Idempotency-Key', { order_status: order.status });
      throw err;
    }
    if (result.outcome === 'declined') return [402, { error: 'the card was declined', code: 'card_declined', order_status: order.status }];

    // A provider fault can take the money twice for one payment: keep one, void the rest.
    const [kept, ...extra] = result.charges;
    for (const charge of extra) this.provider.void(charge);
    order.status = 'paid';
    order.paid_cents = kept!.amount_cents;
    const payment: Payment = {
      id: ++this.payments,
      order_id: order.id,
      amount_cents: kept!.amount_cents,
      status: 'approved',
      card_last4: kept!.card_last4,
      duplicates_voided: extra.length,
      order_status: order.status,
    };
    return [200, payment];
  }

  moveTo(order: Order, status: Status): Order {
    this.refuseMove(order, status);
    order.status = status;
    return order;
  }

  // Before payment nothing is owed, but a timed-out charge may be sitting at the
  // provider, so it is voided. After payment the money goes back in full.
  cancel(order: Order): Order {
    if (this.paying.has(order.id)) throw new HttpError(409, 'payment_in_progress', 'a payment for this order is still running');
    this.refuseMove(order, 'cancelled');
    if (order.paid_cents > 0) this.giveBack(order, order.paid_cents - order.refunded_cents);
    else for (const charge of this.provider.active(String(order.id))) this.provider.void(charge);
    order.status = 'cancelled';
    return order;
  }

  // amount_cents is left out for "everything still refundable".
  refund(order: Order, amount: unknown): Refund {
    if (order.paid_cents === 0) throw new HttpError(409, 'order_not_paid', 'this order has not been paid');
    const refundable = order.paid_cents - order.refunded_cents;
    if (amount !== undefined && !isCents(amount)) throw new HttpError(400, 'invalid_amount', 'amount_cents must be a whole number of cents, at least 1');
    const amount_cents = isCents(amount) ? amount : refundable;
    if (amount_cents > refundable || refundable === 0) throw new HttpError(422, 'refund_exceeds_paid', `only ${refundable} cents can still be refunded`, { refundable_cents: refundable });
    this.giveBack(order, amount_cents);
    return { id: ++this.refunds, order_id: order.id, amount_cents, refunded_cents: order.refunded_cents, refundable_cents: order.paid_cents - order.refunded_cents };
  }

  // Each read moves the pretend driver one step closer, so a test gets the same answer
  // every run; a clock would not.
  track(order: Order): { order_id: number; status: Status; driver_step: number; route_steps: number; eta_minutes: number } {
    if (order.status !== 'out_for_delivery' && order.status !== 'delivered') {
      throw new HttpError(409, 'not_out_for_delivery', 'tracking starts once the order is out for delivery', { order_status: order.status });
    }
    if (order.status === 'delivered') order.driver_steps = ROUTE_STEPS;
    else order.driver_steps = Math.min(order.driver_steps + 1, ROUTE_STEPS - 1);
    return { order_id: order.id, status: order.status, driver_step: order.driver_steps, route_steps: ROUTE_STEPS, eta_minutes: (ROUTE_STEPS - order.driver_steps) * MINUTES_PER_STEP };
  }

  private giveBack(order: Order, cents: number): void {
    order.refunded_cents += cents;
    this.provider.refund(String(order.id), cents);
  }

  private refuseMove(order: Order, status: Status): void {
    const allowed = allowedNext(order.status, order.fulfilment);
    if (!allowed.includes(status)) throw new HttpError(409, 'invalid_transition', `an order that is ${order.status} cannot become ${status}`, { status: order.status, allowed });
  }
}
