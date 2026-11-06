import type { AddressInfo } from 'node:net';
import { after } from 'node:test';
import { createApp } from '../src/app.ts';
import { Shop } from '../src/shop.ts';

export interface Reply { status: number; headers: Headers; body: any }

export interface Api {
  shop: Shop;
  base: string;
  login(email: string, password: string): Promise<string>;
  request(method: string, path: string, token?: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  placeOrder(token: string): Promise<number>;
  pay(token: string, orderId: number, key: string, card: string): Promise<Reply>;
}

export const AVA = ['ava@foodtruck.test', 'ava-demo-pass'] as const;
export const BEN = ['ben@foodtruck.test', 'ben-demo-pass'] as const;
export const SAM = ['sam@foodtruck.test', 'sam-demo-pass'] as const;

// A fresh shop and a server on a free port, closed after the file's tests.
export async function startApi(shop = new Shop()): Promise<Api> {
  const server = createApp(shop);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  after(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));

  const request: Api['request'] = async (method, path, token, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };

  return {
    shop,
    base,
    request,
    login: async (email, password) => (await request('POST', '/auth/login', undefined, { email, password })).body.token,
    placeOrder: async (token) => (await request('POST', '/orders', token, { items: [{ item_id: 'taco', quantity: 2 }], fulfilment: 'pickup' })).body.id,
    pay: (token, orderId, key, card) => request('POST', `/orders/${orderId}/pay`, token, { card_number: card }, { 'Idempotency-Key': key }),
  };
}
