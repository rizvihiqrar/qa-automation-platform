// Shared by the trace tests and playwright.config.ts. The config starts
// scripts/otlp-receiver.ts next to the API and points the API's OpenTelemetry
// exporters at it; these helpers ask the receiver what arrived.
import { randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import type { FlatLog, FlatSpan, Series } from '../scripts/otlp-receiver.ts';

export type { FlatLog, FlatSpan, Series };

// One receiver per Stryker worker, like the API's own port.
export const receiverPort = 14318 + Number(process.env.STRYKER_MUTATOR_WORKER ?? 0);
const receiver = `http://localhost:${receiverPort}`;

export const SERVER = 2; // span kind
export const ERROR = 2;  // span status code

// A new trace for one request: sent as the W3C `traceparent` header, it makes the
// API's spans children of this test's (made-up) span, under this trace id. Parallel
// tests each have their own id, so they never read each other's spans.
export function newTrace(): { traceId: string; headers: { traceparent: string } } {
  const traceId = randomBytes(16).toString('hex');
  return { traceId, headers: { traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01` } };
}

// The trace's spans, once its server span has arrived: the server span ends last,
// after every span inside it, and spans are sent in the order they end.
export async function spansOf(traceId: string): Promise<FlatSpan[]> {
  let spans: FlatSpan[] = [];
  await expect.poll(async () => {
    spans = await (await fetch(`${receiver}/traces/${traceId}`)).json();
    return spans.some((s) => s.kind === SERVER);
  }, {
    message: `no server span for trace ${traceId}: is the API sending to ${receiver}? (a server reused from outside the tests may not be)`,
    timeout: 10_000,
  }).toBe(true);
  return spans;
}

// The trace's log records, once at least `count` have arrived (logs are sent in
// their own batches, so they can come after the spans).
export async function logsOf(traceId: string, count = 1): Promise<FlatLog[]> {
  let logs: FlatLog[] = [];
  await expect.poll(async () => {
    logs = await (await fetch(`${receiver}/logs/${traceId}`)).json();
    return logs.length;
  }, { message: `fewer than ${count} log records for trace ${traceId}`, timeout: 10_000 }).toBeGreaterThanOrEqual(count);
  return logs;
}

export const children = (spans: FlatSpan[], parent: FlatSpan): FlatSpan[] =>
  spans.filter((s) => s.parentSpanId === parent.spanId);

export function only(spans: FlatSpan[], name: string): FlatSpan {
  const found = spans.filter((s) => s.name === name);
  expect(found.map((s) => s.name), `exactly one ${name} span`).toEqual([name]);
  return found[0]!;
}

export async function metric(name: string): Promise<{ unit: string; series: Series[] }> {
  return (await fetch(`${receiver}/metrics/${name}`)).json();
}

// A counter's current total, over its series that have all of `attributes`.
export async function total(name: string, attributes: Record<string, unknown> = {}): Promise<number> {
  const { series } = await metric(name);
  return series
    .filter((s) => Object.entries(attributes).every(([k, v]) => s.attributes[k] === v))
    .reduce((sum, s) => sum + (s.value ?? 0), 0);
}
