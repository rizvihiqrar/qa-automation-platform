// The API in this process, for the property tests (Day 39 of docs/ai-written-code).
// The Playwright suites start the server as a separate process; these tests import
// the app instead, so a test can make hundreds of requests in a second and Stryker
// can reach the route code through them (stryker.config.mjs). Each test file runs
// in its own process under `node --test`, so each gets a fresh store.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import app from '../../src/app.ts';
import { seedAdmin } from '../../src/db/seed.ts';
import { ADMIN, PASSWORD } from '../admin.ts';

export interface Api {
  call: (method: string, path: string, body?: unknown, token?: string) => Promise<{ status: number; body: any }>;
  admin: string;
  customer: () => Promise<{ id: number; token: string }>;
  product: (price: number, stock?: number) => Promise<number>;
  close: () => Promise<void>;
}

let customers = 0;

export async function startApi(): Promise<Api> {
  await seedAdmin({ ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call: Api['call'] = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  const signIn = await call('POST', '/auth/login', ADMIN);
  if (signIn.status !== 200) throw new Error(`admin sign-in failed: ${signIn.status}`);
  const admin: string = signIn.body.token;

  return {
    call,
    admin,
    // Sign-up gives a token straight away, so no sign-in limit applies.
    async customer() {
      const n = ++customers;
      const res = await call('POST', '/auth/register', { name: `Shopper ${n}`, email: `shopper${n}-${process.pid}@example.test`, password: PASSWORD });
      if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
      return { id: res.body.user.id, token: res.body.token };
    },
    async product(price, stock = 1_000_000) {
      const res = await call('POST', '/products', { name: `Item ${price}`, category: 'test', price, stock }, admin);
      if (res.status !== 201) throw new Error(`product setup failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.id;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Exact decimal money, as a reference the code under test doesn't share: an
// amount string such as "19.99" read as BigInt cents, without floats.
export function centsOf(amount: string): bigint {
  const [whole, frac = ''] = amount.split('.');
  return BigInt(whole ?? '0') * 100n + BigInt(frac.padEnd(2, '0'));
}

// "1999" cents → "19.99", the way a person would write the price.
export const amountOf = (cents: bigint | number): string => {
  const c = BigInt(cents);
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
};
