// A stand-in for the three Langfuse endpoints this package uses, for unit tests on a
// machine without Docker. It stores OTLP spans the way Langfuse maps them (the span ID
// becomes the observation ID; the same ID sent twice is one observation) and serves
// them from the v2 observations API with cursor paging. CI checks the real Langfuse.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Langfuse, Observation } from '../src/trace.ts';

interface OtlpAttr { key: string; value: { stringValue?: string; arrayValue?: unknown } }
interface OtlpSpan { traceId: string; spanId: string; parentSpanId?: string; name: string; startTimeUnixNano: string; attributes: OtlpAttr[] }

export interface Fake {
  lf: Langfuse;
  observations: Map<string, Observation>;
  requests: { path: string; headers: http.IncomingHttpHeaders }[];
  /** Answer the next n OTLP posts with this status instead of storing them. */
  failNext(n: number, status: number): void;
  close(): Promise<void>;
}

export async function startFake(pageSize = 250): Promise<Fake> {
  const lf = { baseUrl: '', publicKey: 'pk-lf-test', secretKey: 'sk-lf-test' };
  const observations = new Map<string, Observation>();
  const requests: Fake['requests'] = [];
  let failing = 0;
  let failStatus = 500;
  const authorized = (h: http.IncomingHttpHeaders) =>
    h.authorization === `Basic ${Buffer.from(`${lf.publicKey}:${lf.secretKey}`).toString('base64')}`;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    requests.push({ path: url.pathname, headers: req.headers });
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/public/health') return send(200, { status: 'OK', version: 'fake' });
    if (!authorized(req.headers)) return send(401, { message: 'Invalid credentials' });

    if (req.method === 'POST' && url.pathname === '/api/public/otel/v1/traces') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (failing > 0) { failing -= 1; return send(failStatus, { message: 'fake failure' }); }
        const payload = JSON.parse(body) as { resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[] };
        for (const span of payload.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans))) {
          const a = Object.fromEntries(span.attributes.map((x) => [x.key, x.value.stringValue ?? x.value.arrayValue]));
          observations.set(span.spanId, {
            id: span.spanId,
            traceId: span.traceId,
            parentObservationId: span.parentSpanId ?? null,
            type: String(a['langfuse.observation.type'] ?? 'span').toUpperCase(),
            name: span.name,
            sessionId: (a['langfuse.session.id'] as string) ?? null,
            input: a['langfuse.observation.input'] ?? null,
            output: a['langfuse.observation.output'] ?? null,
            metadata: {},
            model: (a['langfuse.observation.model.name'] as string) ?? null,
            startTime: new Date(Number(BigInt(span.startTimeUnixNano) / 1_000_000n)).toISOString(),
          });
        }
        send(200, {});
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/public/v2/observations') {
      const all = [...observations.values()];
      const from = Number(url.searchParams.get('cursor') ?? 0);
      const size = Math.min(pageSize, Number(url.searchParams.get('limit') ?? 50));
      const next = from + size < all.length ? String(from + size) : null;
      return send(200, { data: all.slice(from, from + size), meta: { cursor: next } });
    }
    send(404, { message: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  lf.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    lf, observations, requests,
    failNext(n, status) { failing = n; failStatus = status; },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
