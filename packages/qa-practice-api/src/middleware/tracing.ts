import { context, propagation, trace, SpanKind, SpanStatusCode, type Attributes } from '@opentelemetry/api';
import type { RequestHandler, Request, Response } from 'express';
import { tracer, requestDuration } from '../telemetry.ts';

// The route template (/orders/:id), never the path with its ids (/orders/17): a
// metric gets one series per attribute value, so ids would make one per order.
// Unknown until Express has matched a route, so it is read when the reply is sent;
// a 404 has none. An error passed on to app.ts leaves the router, which resets
// req.baseUrl but not req.route, so handle.ts calls rememberRoute while both are
// still right ("POST /" instead of "POST /orders" otherwise).
function routeOf(req: Request): string | undefined {
  const path = req.route?.path;
  if (typeof path !== 'string') return undefined;
  return req.baseUrl + (path === '/' && req.baseUrl ? '' : path);
}

export function rememberRoute(req: Request, res: Response): void {
  res.locals.route ??= routeOf(req);
}

// One server span per request, named "POST /orders". A caller's `traceparent`
// header makes it part of the caller's trace: that is how a test finds the spans
// of its own request. Only the method, path and route are recorded, never headers
// or bodies, so no token, password or email reaches the traces.
export const tracing: RequestHandler = (req, res, next) => {
  const parent = propagation.extract(context.active(), req.headers);
  const span = tracer.startSpan(req.method, {
    kind: SpanKind.SERVER,
    attributes: { 'http.request.method': req.method, 'url.path': req.path },
  }, parent);
  const started = performance.now();

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    const route = res.locals.route ?? routeOf(req);
    const status = res.statusCode;
    const attributes: Attributes = { 'http.request.method': req.method };
    if (route) {
      attributes['http.route'] = route;
      span.updateName(`${req.method} ${route}`);
    }
    // Closed before the reply was sent: there is no status code (statusCode would
    // still say 200), so the request counts as aborted, not as a success.
    if (!res.writableFinished) {
      attributes['error.type'] = 'aborted';
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'client closed the connection before the reply' });
    } else {
      attributes['http.response.status_code'] = status;
      // A 4xx is the caller's mistake, not the server's: the OpenTelemetry rules leave
      // a server span's status unset for it. Only a 5xx marks the request failed.
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.setAttributes(attributes);
    span.end();
    requestDuration.record((performance.now() - started) / 1000, attributes);
  };
  res.once('finish', end);
  res.once('close', end); // the client went away before the reply was sent

  context.with(trace.setSpan(parent, span), next);
};
