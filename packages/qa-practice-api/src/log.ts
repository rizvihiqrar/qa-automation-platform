import { emitLog } from './telemetry.ts';

// One line per problem, with the time and, for a request, which one. Found by the
// incident game day (docs/rca/06): 355 identical lines with no time in them could
// not be lined up with the pager, so the responder could not say when it started.
export function logError(message: string, request?: { method: string; path: string }): void {
  const where = request ? `${request.method} ${request.path} ` : '';
  console.error(`${new Date().toISOString()} ${where}${message}`);
  // The same line as a log record, joined to the request's trace (src/telemetry.ts).
  // The path only, never the query string. Callers pass their own wording or a
  // connection-level driver message (a refused or dropped connection), never a
  // request body or a row; the Collector also masks emails and tokens (collector/config.yaml).
  emitLog('ERROR', message, request ? { 'http.request.method': request.method, 'url.path': request.path } : {});
}
