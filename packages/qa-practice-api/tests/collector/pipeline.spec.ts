import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { makeProduct, signUp } from '../design/helpers.ts';
import { newTrace } from '../telemetry.ts';

// The real pipeline (collector/config.yaml), started in Docker by `npm run
// test:collector`: the API sends OTLP to an OpenTelemetry Collector, which sends
// traces on to Jaeger and writes logs to a file. These tests read both back, so
// they prove what the in-process receiver (tests/telemetry.spec.ts) cannot: that
// the configuration works end to end, and that the Collector keeps its promises.

const collector = process.env.COLLECTOR_URL!;
const jaeger = process.env.JAEGER_URL!;
const logsFile = process.env.COLLECTOR_LOGS_FILE!;

interface JaegerSpan { spanID: string; operationName: string; tags: { key: string; value: unknown }[]; processID: string }
interface JaegerTrace { traceID: string; spans: JaegerSpan[] }
interface LogRecord { traceId: string; spanId: string; severityText: string; body: { stringValue?: string }; attributes: { key: string }[] }

// The trace as Jaeger stores it, once it is there (the Collector batches for 200 ms).
async function traceInJaeger(traceId: string, wanted = (t: JaegerTrace) => t.spans.length > 0): Promise<JaegerTrace> {
  let found: JaegerTrace | undefined;
  await expect.poll(async () => {
    const res = await fetch(`${jaeger}/api/traces/${traceId}`);
    found = res.ok ? ((await res.json()) as { data: JaegerTrace[] }).data?.[0] : undefined;
    return !!found && wanted(found);
  }, { message: `trace ${traceId} never reached Jaeger through the Collector (${jaeger}/api/traces/<id>; is the API sending to ${collector}?)`, timeout: 20_000 }).toBe(true);
  return found!;
}

// Every log record the Collector has written so far (one JSON line per batch).
function writtenLogs(): LogRecord[] {
  let text = '';
  try { text = readFileSync(logsFile, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).flatMap((line) =>
    (JSON.parse(line).resourceLogs ?? []).flatMap((r: any) => (r.scopeLogs ?? []).flatMap((s: any) => s.logRecords ?? [])));
}

async function logsOfTrace(traceId: string): Promise<LogRecord[]> {
  let records: LogRecord[] = [];
  await expect.poll(() => (records = writtenLogs().filter((r) => r.traceId === traceId)).length, {
    message: `no log record for trace ${traceId} in ${logsFile}`, timeout: 20_000,
  }).toBeGreaterThan(0);
  return records;
}

// An OTLP/JSON batch posted straight to the Collector, the way a badly written
// service might send one: with a secret where it should not be.
const str = (key: string, stringValue: string) => ({ key, value: { stringValue } });
const nowNs = () => String(BigInt(Date.now()) * 1_000_000n);

test.describe('OpenTelemetry Collector pipeline', () => {
  test.skip(!process.env.COLLECTOR_URL, 'needs npm run test:collector (Docker)');

  test('CL-01 the Collector is healthy and takes OTLP over HTTP @regression', async () => {
    const health = await fetch(process.env.COLLECTOR_HEALTH_URL!);
    expect(health.status).toBe(200);
    const empty = await fetch(`${collector}/v1/traces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resourceSpans: [] }),
    });
    expect(empty.status).toBe(200);
  });

  test('CL-02 an order made through the API arrives in Jaeger as one trace with its spans @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 5 });
    const buyer = await signUp(request);
    const { traceId, headers } = newTrace();
    const res = await request.post('/orders', {
      headers: { ...buyer.auth, ...headers }, data: { items: [{ product_id: product.id, quantity: 1 }] },
    });
    expect(res.status()).toBe(201);

    const trace = await traceInJaeger(traceId, (t) => ['POST /orders', 'order.create', 'db.transaction'].every((n) => t.spans.some((s) => s.operationName === n)));
    expect(trace.spans.map((s) => s.operationName)).toEqual(expect.arrayContaining(['POST /orders', 'order.create', 'db.transaction', 'db.lock']));
  });

  test('CL-03 a log line written during a request carries the id of a span stored in Jaeger @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 1 });
    const buyer = await signUp(request);
    const { traceId, headers } = newTrace();
    expect((await request.post('/orders', {
      headers: { ...buyer.auth, ...headers }, data: { items: [{ product_id: product.id, quantity: 2 }] },
    })).status()).toBe(400);

    const [log] = await logsOfTrace(traceId);
    expect(log).toMatchObject({ severityText: 'WARN', body: { stringValue: 'order refused' } });
    // The join: the log's span id is a span of the same trace in the trace store.
    const trace = await traceInJaeger(traceId, (t) => t.spans.some((s) => s.spanID === log!.spanId));
    expect(trace.spans.find((s) => s.spanID === log!.spanId)?.operationName).toBe('order.create');
  });

  test('CL-04 the Collector removes secrets from spans and logs before they are stored @regression @security', async () => {
    const { traceId } = newTrace();
    const spanId = '1122334455667788';
    const post = (path: string, body: unknown) => fetch(`${collector}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const resource = { attributes: [str('service.name', 'badly-behaved-service')] };
    const secrets = {
      email: 'someone.private@example.com', bearer: 'Bearer abc.def.ghi-123', password: 'Hunter2-not-for-storage',
    };

    expect((await post('/v1/traces', { resourceSpans: [{ resource, scopeSpans: [{ spans: [{
      traceId, spanId, name: 'checkout', kind: 2, startTimeUnixNano: nowNs(), endTimeUnixNano: nowNs(),
      attributes: [
        str('http.request.header.authorization', secrets.bearer), // dropped by key
        str('password', secrets.password),                        // dropped by key
        str('note', `sent to ${secrets.email}`),                  // masked by value
        str('step', 'payment'),                                   // kept
      ],
    }] }] }] })).status).toBe(200);
    expect((await post('/v1/logs', { resourceLogs: [{ resource, scopeLogs: [{ logRecords: [{
      traceId, spanId, severityText: 'ERROR', timeUnixNano: nowNs(),
      body: { stringValue: `login failed for ${secrets.email} with ${secrets.bearer}` },
      attributes: [str('user.email', secrets.email), str('step', 'payment')],
    }] }] }] })).status).toBe(200);

    const stored = await traceInJaeger(traceId);
    const [log] = await logsOfTrace(traceId);
    const span = stored.spans.find((s) => s.operationName === 'checkout')!;
    const text = JSON.stringify([stored, log]);
    for (const secret of [...Object.values(secrets), 'abc.def.ghi-123']) expect(text, `${secret} was stored`).not.toContain(secret);
    // Only the secrets went: the span and the log are still there, and the safe attribute stays.
    expect(span.tags).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'step', value: 'payment' })]));
    expect(span.tags.map((t) => t.key)).not.toContain('password');
    expect(span.tags.map((t) => t.key)).not.toContain('http.request.header.authorization');
    expect(log!.attributes.map((a) => a.key)).not.toContain('user.email');
    expect(log!.body.stringValue).toContain('login failed for');
  });
});
