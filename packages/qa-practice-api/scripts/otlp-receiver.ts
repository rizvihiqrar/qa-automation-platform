// A small OTLP receiver for the tests: the API sends its traces, metrics and logs here
// (OTEL_EXPORTER_OTLP_ENDPOINT, set in playwright.config.ts), the way it would send
// them to an OpenTelemetry Collector, and the tests ask it what arrived. It keeps
// everything in memory until it stops.
//
//   POST /v1/traces, /v1/metrics, /v1/logs   OTLP over HTTP, JSON encoding (what the
//                                  exporter-*-otlp-http packages send)
//   GET  /traces/:traceId          that trace's spans, flattened (see FlatSpan)
//   GET  /logs/:traceId            that trace's log records, flattened (see FlatLog)
//   GET  /metrics/:name            the latest value of each of the metric's series
//   GET  /health                   200 once it is listening (Playwright waits for it)
//
// Usage: node scripts/otlp-receiver.ts [port]   (OTLP_RECEIVER_PORT, default 4318)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type AnyValue = { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean };
type KeyValue = { key: string; value: AnyValue };
type Attributes = Record<string, string | number | boolean>;

export interface FlatSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: number; // 2 = server
  service: string;
  status: { code: number; message?: string }; // 0 unset, 1 ok, 2 error
  attributes: Attributes;
  events: { name: string; attributes: Attributes }[];
  durationMs: number;
}

export interface FlatLog {
  traceId: string;
  spanId: string;
  severity: string; // WARN, ERROR
  body: string;
  service: string;
  attributes: Attributes;
}

export interface Series {
  attributes: Attributes;
  value?: number; // sums (counters)
  count?: number; // histograms
  sum?: number;
}

const flatten = (list: KeyValue[] = []): Attributes =>
  Object.fromEntries(list.map(({ key, value }) => [key,
    value.stringValue ?? value.boolValue ?? value.doubleValue ?? Number(value.intValue ?? NaN)]));

const traces = new Map<string, FlatSpan[]>();
const logRecords = new Map<string, FlatLog[]>(); // by trace id; a record outside any span has none
// metric name -> series key (its attributes as JSON) -> latest values
const latest = new Map<string, Map<string, Series & { unit: string }>>();

function takeTraces(body: any): void {
  for (const { resource, scopeSpans = [] } of body.resourceSpans ?? []) {
    const service = String(flatten(resource?.attributes)['service.name'] ?? '');
    for (const { spans = [] } of scopeSpans) {
      for (const s of spans) {
        const span: FlatSpan = {
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId || null,
          name: s.name,
          kind: s.kind,
          service,
          status: { code: s.status?.code ?? 0, ...(s.status?.message ? { message: s.status.message } : {}) },
          attributes: flatten(s.attributes),
          events: (s.events ?? []).map((e: any) => ({ name: e.name, attributes: flatten(e.attributes) })),
          // Nanoseconds as decimal strings: past 2^53, so BigInt.
          durationMs: Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1e6,
        };
        traces.set(span.traceId, [...(traces.get(span.traceId) ?? []), span]);
      }
    }
  }
}

function takeLogs(body: any): void {
  for (const { resource, scopeLogs = [] } of body.resourceLogs ?? []) {
    const service = String(flatten(resource?.attributes)['service.name'] ?? '');
    for (const { logRecords: records = [] } of scopeLogs) {
      for (const r of records) {
        const log: FlatLog = {
          traceId: r.traceId ?? '',
          spanId: r.spanId ?? '',
          severity: r.severityText ?? '',
          body: r.body?.stringValue ?? '',
          service,
          attributes: flatten(r.attributes),
        };
        const list = logRecords.get(log.traceId) ?? [];
        list.push(log);
        logRecords.set(log.traceId, list);
      }
    }
  }
}

// The SDK sends cumulative values (the total since the API started), so the latest
// data point of each series is its current total.
function takeMetrics(body: any): void {
  for (const { scopeMetrics = [] } of body.resourceMetrics ?? []) {
    for (const { metrics = [] } of scopeMetrics) {
      for (const m of metrics) {
        const series = latest.get(m.name) ?? new Map();
        latest.set(m.name, series);
        for (const point of m.sum?.dataPoints ?? []) {
          const attributes = flatten(point.attributes);
          series.set(JSON.stringify(attributes), { unit: m.unit ?? '', attributes, value: point.asDouble ?? Number(point.asInt) });
        }
        for (const point of m.histogram?.dataPoints ?? []) {
          const attributes = flatten(point.attributes);
          series.set(JSON.stringify(attributes), { unit: m.unit ?? '', attributes, count: Number(point.count), sum: point.sum });
        }
      }
    }
  }
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://receiver');
  if (req.method === 'POST' && ['/v1/traces', '/v1/metrics', '/v1/logs'].includes(url.pathname)) {
    // The protobuf encoding would arrive as unreadable bytes: say so instead of
    // dropping it quietly.
    if (!req.headers['content-type']?.startsWith('application/json')) {
      return json(res, 415, { error: 'this receiver reads OTLP JSON only' });
    }
    // A body it can't read is refused, never thrown: an error here would stop the
    // receiver, and every later trace test would fail with nothing to read.
    try {
      const body = JSON.parse(await readBody(req));
      if (url.pathname === '/v1/traces') takeTraces(body);
      else if (url.pathname === '/v1/logs') takeLogs(body);
      else takeMetrics(body);
    } catch (err) {
      return json(res, 400, { error: `could not read the OTLP body: ${(err as Error).message}` });
    }
    return json(res, 200, {});
  }
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' });
  const trace = url.pathname.match(/^\/traces\/([0-9a-f]{32})$/);
  if (req.method === 'GET' && trace) return json(res, 200, traces.get(trace[1]!) ?? []);
  const log = url.pathname.match(/^\/logs\/([0-9a-f]{32})$/);
  if (req.method === 'GET' && log) return json(res, 200, logRecords.get(log[1]!) ?? []);
  const metric = url.pathname.match(/^\/metrics\/([\w.]+)$/);
  if (req.method === 'GET' && metric) {
    const series = latest.get(metric[1]!);
    return json(res, 200, series ? { unit: [...series.values()][0]?.unit ?? '', series: [...series.values()].map(({ unit: _, ...s }) => s) } : { unit: '', series: [] });
  }
  json(res, 404, { error: `${req.method} ${url.pathname} not found` });
});

const port = Number(process.argv[2] ?? process.env.OTLP_RECEIVER_PORT ?? 4318);
server.listen(port, () => console.log(`OTLP receiver on http://localhost:${port}`));
