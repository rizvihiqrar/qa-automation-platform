// The load run and the readers for tests/sampling. The run is made of requests whose
// trace ids it chooses (the API continues the caller's `traceparent`), so it always knows
// which traces it made and which of them failed, and every policy can be checked against
// that list rather than against a count taken from the same Collector.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const TOTAL = 1000;       // traces in the run
export const ERROR_EVERY = 10;   // every 10th request fails: 100 error traces, 900 fine ones
export const POLICIES = ['all', 'head', 'tail'] as const;
export type Policy = (typeof POLICIES)[number];

// A small seeded generator (mulberry32): the same ids on every run, so the same traces are
// kept or dropped on every run and a failing check is a real change, not bad luck.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Sent { traceId: string; fails: boolean }

export function plan(seed = 434): Sent[] {
  const next = seeded(seed);
  const hex = (bytes: number) => Array.from({ length: bytes }, () => Math.floor(next() * 256).toString(16).padStart(2, '0')).join('');
  return Array.from({ length: TOTAL }, (_, i) => ({ traceId: hex(16), fails: i % ERROR_EVERY === ERROR_EVERY - 1 }));
}

// Sends the plan to the API as orders (an order is several spans: the request, the order,
// the transaction and a lock), `parallel` at a time. A failing request is refused by the
// API before it reaches the order code, so a failing trace is one span and a fine one has
// several. Returns the statuses by trace id.
export async function sendAll(baseURL: string, sent: Sent[], order: { auth: string; productId: number }, parallel = 20): Promise<Map<string, number>> {
  const statuses = new Map<string, number>();
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < sent.length) {
      const { traceId, fails } = sent[next++]!;
      const res = await fetch(`${baseURL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // A fresh connection per request: a reused one the server has just closed fails the
          // request with ECONNRESET, and a resend would add a second span to the trace.
          Connection: 'close',
          Authorization: order.auth,
          traceparent: `00-${traceId}-${traceId.slice(0, 16)}-01`,
          ...(fails ? { 'X-Fault': 'error' } : {}),
        },
        body: JSON.stringify({ items: [{ product_id: order.productId, quantity: 1 }] }),
      });
      await res.arrayBuffer();
      statuses.set(traceId, res.status);
    }
  }));
  return statuses;
}

interface OtlpSpan { traceId: string; status?: { code?: number | string } }
export interface Kept { spans: number; bytes: number; failed: boolean }

// What one policy's file holds, for the traces of this run only (the readiness probe and
// anything else that reached the API is ignored): spans, their size as JSON, and whether
// any span in the trace is marked failed. Keyed by trace id.
export function readPolicy(dir: string, policy: Policy, mine: Set<string>): Map<string, Kept> {
  let text = '';
  try { text = readFileSync(path.join(dir, `${policy}.jsonl`), 'utf8'); } catch { /* not written yet */ }
  const traces = new Map<string, Kept>();
  const lines = text.split('\n').filter(Boolean);
  for (const [i, line] of lines.entries()) {
    let batch: { resourceSpans?: any[] };
    try { batch = JSON.parse(line); } catch (err) {
      // The Collector may be in the middle of writing the last line; the next poll reads it whole.
      if (i === lines.length - 1) continue;
      throw err;
    }
    for (const resource of batch.resourceSpans ?? []) {
      for (const scope of resource.scopeSpans ?? []) {
        for (const span of (scope.spans ?? []) as OtlpSpan[]) {
          if (!mine.has(span.traceId)) continue;
          const kept = traces.get(span.traceId) ?? { spans: 0, bytes: 0, failed: false };
          kept.spans += 1;
          kept.bytes += JSON.stringify(span).length;
          kept.failed ||= span.status?.code === 2 || span.status?.code === 'STATUS_CODE_ERROR';
          traces.set(span.traceId, kept);
        }
      }
    }
  }
  return traces;
}
