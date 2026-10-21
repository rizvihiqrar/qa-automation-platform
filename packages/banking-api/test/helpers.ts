import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { createApp, type Screen } from '../src/app.ts';
import { Ledger } from '../src/ledger.ts';
import { spawnServers, type Running } from '../src/servers.ts';

export interface Reply {
  status: number;
  headers: Headers;
  body: any;
}

export interface Api {
  ledger: Ledger;
  base: string;
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  post(path: string, body: unknown): Promise<Reply>;
  get(path: string): Promise<Reply>;
  openAccount(currency: string, owner?: string): Promise<number>;
}

// A fresh ledger in memory and a server on a free port, closed after the file's tests.
// A string body is sent as it is (for malformed JSON); anything else as JSON.
// `now` sets the ledger's clock and `screen` the wait before each movement.
export async function startApi({ now, screen }: { now?: () => string; screen?: Screen } = {}): Promise<Api> {
  const ledger = new Ledger(':memory:', now);
  const server = createApp(ledger, { screen });
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
    base,
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

export interface Servers {
  dbPath: string;
  bases: string[];
  post(base: string, path: string, body: unknown, headers?: Record<string, string>): Promise<Reply>;
  get(base: string, path: string): Promise<Reply>;
}

// Real server processes sharing one SQLite file in a fresh temp folder (see
// spawnServers). Stopped, and the folder removed, after the file's tests; until then a
// test can open dbPath and run the SQL ledger checks on what the race left.
export async function startServers(count: number, env: Record<string, string> = {}): Promise<Servers> {
  const dir = mkdtempSync(join(tmpdir(), 'banking-api-'));
  const dbPath = join(dir, 'ledger.db');
  let running: Running | undefined;
  after(async () => {
    await running?.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  running = await spawnServers(count, dbPath, env);
  const { bases } = running;

  const request = async (base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => {
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json', ...headers };
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  return {
    dbPath,
    bases,
    post: (base, path, body, headers) => request(base, 'POST', path, body, headers),
    get: (base, path) => request(base, 'GET', path),
  };
}
