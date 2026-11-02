import { test, expect } from '@playwright/test';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { Router, type ErrorRequestHandler } from 'express';
import { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-node';
import { tracing } from '../src/middleware/tracing.ts';
import { handle } from '../src/middleware/handle.ts';

// Unit tests of the request span (src/middleware/tracing.ts) for what the API can't
// be made to do on purpose: a handler that throws (a 500) and a client that hangs
// up before the reply. A small app in this test process uses the real middleware;
// its spans go to an in-memory exporter instead of over OTLP.

const exporter = new InMemorySpanExporter();
new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();

const router = Router();
router.get('/:id', handle(async () => { throw new Error('broken on purpose'); }));
router.get('/:id/slow', handle(async (_req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  res.json({ late: true });
}));
const onError: ErrorRequestHandler = (_err, _req, res, _next) => { res.status(500).json({ error: 'Internal server error' }); };
const app = express().use(tracing).use('/things', router).use(onError);

let base = '';
let server: ReturnType<typeof app.listen>;
test.beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => { server.close(); });

const spanFor = async (path: string) => {
  await expect.poll(() => exporter.getFinishedSpans().some((s) => s.attributes['url.path'] === path)).toBe(true);
  return exporter.getFinishedSpans().find((s) => s.attributes['url.path'] === path)!;
};

test.describe('request span', () => {
  test('OT-07 a handler that throws keeps its router\'s route on the 500 span @regression', async () => {
    expect((await fetch(`${base}/things/7`)).status).toBe(500);
    const span = await spanFor('/things/7');
    expect(span.name).toBe('GET /things/:id');
    expect(span.attributes).toMatchObject({ 'http.route': '/things/:id', 'http.response.status_code': 500 });
    expect(span.status.code).toBe(2); // error
  });

  test('OT-08 a client that hangs up before the reply is an aborted request, not a 200 @regression', async () => {
    const req = httpRequest(`${base}/things/8/slow`);
    req.on('error', () => {}); // the hang-up below
    req.end();
    setTimeout(() => req.destroy(), 100);
    const span = await spanFor('/things/8/slow');
    expect(span.attributes['error.type']).toBe('aborted');
    expect(span.attributes['http.response.status_code']).toBeUndefined();
    expect(span.status.code).toBe(2);
  });
});
