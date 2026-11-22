import type { Flow } from './proxy.ts';

// The wire rules (BK-R41, with BK-R18 and BK-R32 seen from the outside), applied to
// what a proxy recorded. Returns one line per problem, so a test can show all of them
// at once and the checks themselves can be tried on flows made to break them.

// A URL is a route and ids: the server's whole route table, and the UI's three files.
const ROUTE = /^\/(?:|health|app\.js|app\.css|accounts|transfers|accounts\/[1-9]\d{0,14}(?:\/(?:entries|deposits|withdrawals))?|transfers\/[1-9]\d{0,14})$/;
const UI_FILES = new Set(['/', '/app.js', '/app.css']);
const UI_POLICY = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const header = (pairs: [string, string][], name: string): string[] =>
  pairs.filter(([k]) => k.toLowerCase() === name).map(([, v]) => v);

// `secrets` are the values a client sent that must never show up in a URL: amounts,
// owner names, references. Keys are found in the flows themselves.
export function wireProblems(flows: Flow[], secrets: string[] = []): string[] {
  const problems: string[] = [];
  for (const flow of flows) {
    const where = `${flow.method} ${flow.path}`;
    if (/[?#]/.test(flow.path)) problems.push(`${where}: a query string or fragment in the URL`);
    else if (!ROUTE.test(flow.path)) problems.push(`${where}: not a route of the API or the UI`);
    const readable = (() => { try { return decodeURIComponent(flow.path); } catch { return flow.path; } })(); // a broken % escape is reported as a route problem, not thrown
    for (const secret of secrets) {
      if (readable.includes(secret)) problems.push(`${where}: "${secret}" is in the URL`);
    }
    for (const name of ['set-cookie', 'server', 'x-powered-by']) {
      if (header(flow.response_headers, name).length) problems.push(`${where}: the reply has a ${name} header`);
    }
    if (!header(flow.response_headers, 'cache-control').includes('no-store')) problems.push(`${where}: the reply is not Cache-Control: no-store`);
    if (!header(flow.response_headers, 'x-content-type-options').includes('nosniff')) problems.push(`${where}: the reply is not nosniff`);
    if (UI_FILES.has(flow.path) && flow.status === 200 && !header(flow.response_headers, 'content-security-policy').includes(UI_POLICY)) {
      problems.push(`${where}: the UI file has no Content-Security-Policy of its own origin`);
    }
    for (const key of header(flow.request_headers, 'idempotency-key')) {
      if (flow.response_body.includes(key)) problems.push(`${where}: the reply repeats the Idempotency-Key`);
    }
  }
  return problems;
}
