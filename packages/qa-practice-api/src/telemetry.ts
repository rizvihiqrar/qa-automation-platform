// OpenTelemetry: the API reports what it does as traces (one per request, made of
// spans: the request, the order, the transaction, each row lock) and metrics
// (counters and timings). Nothing is sent unless OTEL_EXPORTER_OTLP_ENDPOINT is
// set: without it the API calls below do nothing, so a plain `npm start` is as
// before. The tests set it to their own receiver (scripts/otlp-receiver.ts);
// `npm run start:jaeger` sets it to a local Jaeger (jaeger.env).
//
// The spans are written by hand, not by the auto-instrumentation packages: those
// need a module loader hook to patch Express and pg under ES modules, and the
// spans here are the ones the tests check (tests/telemetry.spec.ts).
import { trace, metrics, SpanStatusCode, type Span, type Attributes } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';

const env = process.env;
const enabled = !!env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (enabled) {
  const resource = resourceFromAttributes({ 'service.name': env.OTEL_SERVICE_NAME ?? 'qa-practice-api' });
  // Spans are sent in batches every OTEL_BSP_SCHEDULE_DELAY ms, which the SDK reads
  // itself (5 s by default; the tests use 50 ms so they don't wait).
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  // Also sets the W3C propagator, which reads a caller's `traceparent` header, and
  // the context manager that carries the current span across awaits.
  tracerProvider.register();

  // Jaeger takes traces only, so jaeger.env turns metrics off (OTEL_METRICS_EXPORTER=none).
  if (env.OTEL_METRICS_EXPORTER !== 'none') {
    // The metric reader doesn't read its interval from the environment (only the
    // full NodeSDK does), so it is read here: 60 s by default, 200 ms in the tests.
    const interval = Number(env.OTEL_METRIC_EXPORT_INTERVAL) || 60_000;
    metrics.setGlobalMeterProvider(new MeterProvider({
      resource,
      readers: [new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: interval,
        exportTimeoutMillis: Math.min(interval, 30_000),
      })],
    }));
  }

  // Send what is still queued before the process ends.
  const shutdown = () => {
    Promise.allSettled([tracerProvider.shutdown(), (metrics.getMeterProvider() as MeterProvider).shutdown?.()])
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export const tracer = trace.getTracer('qa-practice-api');

// Created after the meter provider above, or they would stay no-op instruments.
const meter = metrics.getMeter('qa-practice-api');
export const requestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Time to answer an HTTP request', unit: 's',
});
export const ordersCreated = meter.createCounter('orders.created', { description: 'Orders placed' });
export const ordersRejected = meter.createCounter('orders.rejected', {
  description: 'Orders refused, by reason (qa.order.reject_reason)',
});

// Runs `work` inside a new span, which ends when it does. A thrown error marks the
// span as failed and is recorded on it, then thrown on.
export async function inSpan<R>(name: string, attributes: Attributes, work: (span: Span) => Promise<R>): Promise<R> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await work(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
