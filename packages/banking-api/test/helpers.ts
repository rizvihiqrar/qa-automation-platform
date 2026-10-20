import type { AddressInfo } from 'node:net';
import { after } from 'node:test';
import { createApp } from '../src/app.ts';
import { Ledger } from '../src/ledger.ts';

export interface Reply {
  status: number;
  headers: Headers;
  body: any;
}

export interface Api {
  ledger: Ledger;
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  post(path: string, body: unknown): Promise<Reply>;
  get(path: string): Promise<Reply>;
  openAccount(currency: string, owner?: string): Promise<number>;
}

// A fresh ledger in memory and a server on a free port, closed after the file's tests.
// A string body is sent as it is (for malformed JSON); anything else as JSON.
export async function startApi(): Promise<Api> {
  const ledger = new Ledger();
  const server = createApp(ledger);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  after(() => new Promise<void>((resolve) => { server.close(() => resolve()); ledger.close(); }));

  const request = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json', ...headers };
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };

  const api: Api = {
    ledger,
    request,
    post: (path, body) => request('POST', path, body),
    get: (path) => request('GET', path),
    async openAccount(currency, owner = 'Test Owner') {
      const reply = await request('POST', '/accounts', { owner, currency });
      if (reply.status !== 201) throw new Error(`could not open a ${currency} account: ${JSON.stringify(reply.body)}`);
      return reply.body.id as number;
    },
  };
  return api;
}
