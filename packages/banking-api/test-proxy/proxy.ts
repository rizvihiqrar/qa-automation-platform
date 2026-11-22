import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { createApp } from '../src/app.ts';
import { Ledger } from '../src/ledger.ts';

// mitmproxy in Docker, in front of a real banking-api server (reverse mode): the
// client talks to the proxy, the proxy to the API, and /out/flows.jsonl keeps what
// went by (proxy/record.py). The tag is pulled by CI through retry.sh before the
// tests run; scripts/proxy-ci.test.mjs fails if ci.yml pulls another tag.
export const PROXY_IMAGE = 'mitmproxy/mitmproxy:12.3.1';

export interface Flow {
  method: string;
  path: string;
  request_headers: [string, string][];
  request_body: string;
  status: number;
  response_headers: [string, string][];
  response_body: string;
  changed: Record<string, unknown> | null;
}

export interface Tamper { method: string; path: string; field: string; value: string }

export interface Wire {
  // What a client uses: the proxy's address. `api` is the server itself, behind it.
  base: string;
  api: string;
  ledger: Ledger;
  flows(): Flow[];
  tamper(change: Tamper | null): void;
}

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// A server on every interface (the container reaches it as host.docker.internal, which is
// not 127.0.0.1 on Docker Desktop), a proxy container in front of it, and clean-up after the
// file's tests. The ledger is empty and in memory, and the server lives only for the run.
export async function startWire(): Promise<Wire> {
  const ledger = new Ledger();
  const server = createApp(ledger);
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const port = (server.address() as AddressInfo).port;

  const out = mkdtempSync(join(tmpdir(), 'banking-proxy-'));
  chmodSync(out, 0o777); // the container's user writes the recording here
  const flowsFile = join(out, 'flows.jsonl');
  const controlFile = join(out, 'control.json');
  writeFileSync(flowsFile, '');
  chmodSync(flowsFile, 0o666);
  const addons = fileURLToPath(new URL('../proxy/', import.meta.url));
  const name = `banking-wire-${process.pid}-${Date.now()}`;

  const stop = () => {
    try { docker('rm', '-f', name); } catch { /* already gone */ }
    rmSync(out, { recursive: true, force: true });
  };
  process.once('exit', stop);
  // The container goes first (nothing more can arrive), then the server's connections and the
  // server, and the ledger last.
  after(() => new Promise<void>((resolve) => {
    stop();
    server.close(() => { ledger.close(); resolve(); });
    server.closeAllConnections();
  }));

  docker('run', '-d', '--rm', '--name', name,
    '--add-host', 'host.docker.internal:host-gateway',
    '-p', '127.0.0.1::8080',
    '-v', `${out}:/out`, '-v', `${addons}:/addons:ro`,
    PROXY_IMAGE,
    'mitmdump', '--mode', `reverse:http://host.docker.internal:${port}`,
    '--listen-host', '0.0.0.0', '--listen-port', '8080', '-s', '/addons/record.py', '--set', 'flow_detail=0');
  const bound = docker('port', name, '8080/tcp').split('\n')[0]!; // 127.0.0.1:49153
  const base = `http://${bound.replace('0.0.0.0', '127.0.0.1')}`;

  // Ready when a request goes through to the API and back.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).status === 200) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`the proxy did not come up:\n${docker('logs', name)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    base,
    api: `http://127.0.0.1:${port}`,
    ledger,
    // The readiness probe's own /health is not part of any test.
    flows: () => readFileSync(flowsFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Flow).filter((f) => f.path !== '/health'),
    tamper(change) {
      if (change) writeFileSync(controlFile, JSON.stringify({ tamper: change }));
      else rmSync(controlFile, { force: true });
    },
  };
}

// One request through the proxy, as a client sends it.
export interface Seen { status: number; headers: Headers; text: string; body: any }
export async function send(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Seen> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...headers };
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* a UI file, not JSON */ }
  return { status: res.status, headers: res.headers, text, body: parsed };
}
