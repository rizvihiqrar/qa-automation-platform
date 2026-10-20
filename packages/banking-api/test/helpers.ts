import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { createApp, type Screen } from '../src/app.ts';
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

// Real server processes (`node src/server.ts`) sharing one SQLite file in a fresh temp
// folder: the setup in which two requests really run at the same time, since each
// process has its own connection. Started one after another, so only one creates the
// schema. Stopped, and the folder removed, after the file's tests; until then a test
// can open dbPath and look at what the race left (Day 45 runs its SQL checks on it).
export async function startServers(count: number, env: Record<string, string> = {}): Promise<Servers> {
  const dir = mkdtempSync(join(tmpdir(), 'banking-api-'));
  const dbPath = join(dir, 'ledger.db');
  const children: ChildProcess[] = [];
  const bases: string[] = [];
  after(async () => {
    await Promise.all(children.map((child) => new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill();
    })));
    rmSync(dir, { recursive: true, force: true });
  });

  for (let i = 0; i < count; i++) {
    const child = spawn(process.execPath, ['src/server.ts'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ...env, PORT: '0', DATABASE_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    children.push(child);
    bases.push(await new Promise<string>((resolve, reject) => {
      child.once('exit', (code) => reject(new Error(`server ${i} exited with ${code}`)));
      child.stdout!.on('data', (chunk: Buffer) => {
        const port = /listening on http:\/\/localhost:(\d+)/.exec(chunk.toString())?.[1];
        if (port) resolve(`http://127.0.0.1:${port}`);
      });
    }));
  }

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
