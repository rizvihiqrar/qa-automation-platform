import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { basicAuth } from './http.ts';
import { ELAPSED_FORMAT } from './results.ts';

export interface MockOptions {
  testrail?: { user: string; apiKey: string; /** run id to the numeric case ids that run holds */ runs: Record<number, number[]> };
  jira?: { email: string; apiToken: string; projects: string[] };
  /** Answer the first N requests with 429 and a one second Retry-After. */
  rateLimitFirst?: number;
  port?: number;
}

export interface MockServer {
  url: string;
  /** Every request body the mock accepted, in order. */
  accepted: { testrail: unknown[]; jira: unknown[] };
  close: () => Promise<void>;
}

const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

function checkTestRailBody(body: unknown, caseIds: number[]): string | null {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return 'Field :results is a required field.';
  for (const r of results as Array<Record<string, unknown>>) {
    if (!Number.isInteger(r.case_id)) return 'Field :case_id is a required field.';
    if (!caseIds.includes(r.case_id as number)) return 'Field :case_id is not a valid test case for this run: ' + String(r.case_id);
    if (!Number.isInteger(r.status_id) || (r.status_id as number) < 1) return 'Field :status_id is not a valid status.';
    if (r.elapsed !== undefined && !(typeof r.elapsed === 'string' && ELAPSED_FORMAT.test(r.elapsed))) return 'Field :elapsed has an invalid time span.';
  }
  return null;
}

// True when every text node in the document has text; Jira answers 400 "text cannot be empty" otherwise.
function hasEmptyText(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (n.type === 'text' && (typeof n.text !== 'string' || n.text === '')) return true;
  return Array.isArray(n.content) && n.content.some(hasEmptyText);
}

// The v3 issue endpoint refuses a plain-text description; it must be an Atlassian Document Format doc,
// which carries "version": 1 on the document itself.
function checkJiraBody(body: unknown, projects: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const fields = (body as { fields?: Record<string, unknown> } | null)?.fields ?? {};
  const project = (fields.project as { key?: unknown } | undefined)?.key;
  if (typeof project !== 'string' || !projects.includes(project)) errors.project = 'valid project is required';
  if (typeof fields.summary !== 'string' || !fields.summary.trim()) errors.summary = 'You must specify a summary of the issue.';
  else if (fields.summary.length > 255) errors.summary = 'Summary must be less than 255 characters.';
  if (!(fields.issuetype as { name?: unknown } | undefined)?.name) errors.issuetype = 'issue type is required';
  const description = fields.description as { type?: unknown; version?: unknown; content?: unknown } | undefined;
  if (description !== undefined) {
    if (!(description.type === 'doc' && description.version === 1 && Array.isArray(description.content))) {
      errors.description = 'Operation value must be an Atlassian Document (see the Atlassian Document Format)';
    } else if (hasEmptyText(description)) errors.description = 'INVALID_INPUT: text cannot be empty';
  }
  return errors;
}

/** One local server that speaks the documented parts of the TestRail and Jira REST APIs used by the kit. */
export async function startMock(options: MockOptions = {}): Promise<MockServer> {
  const accepted = { testrail: [] as unknown[], jira: [] as unknown[] };
  let rateLimited = 0;
  let nextResultId = 1;
  let nextIssue = 1;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (rateLimited < (options.rateLimitFirst ?? 0)) {
        rateLimited++;
        return send(res, 429, { error: 'Too many requests' }, { 'Retry-After': '1' });
      }
      let body: unknown = null;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
      const url = req.url ?? '';

      const testrailRoute = url.match(/^\/index\.php\?\/api\/v2\/add_results_for_cases\/(\d+)$/);
      if (testrailRoute && req.method === 'POST' && options.testrail) {
        if (req.headers.authorization !== basicAuth(options.testrail.user, options.testrail.apiKey)) {
          return send(res, 401, { error: 'Authentication failed: invalid or missing user/password or session cookie.' });
        }
        const caseIds = options.testrail.runs[Number(testrailRoute[1])];
        if (!caseIds) return send(res, 400, { error: 'Field :run_id is not a valid test run.' });
        const problem = checkTestRailBody(body, caseIds);
        if (problem) return send(res, 400, { error: problem });
        accepted.testrail.push(body);
        const results = (body as { results: Array<Record<string, unknown>> }).results;
        return send(res, 200, results.map((r) => ({ id: nextResultId++, test_id: r.case_id, status_id: r.status_id, comment: r.comment ?? null })));
      }

      if (url === '/rest/api/3/issue' && req.method === 'POST' && options.jira) {
        if (req.headers.authorization !== basicAuth(options.jira.email, options.jira.apiToken)) {
          return send(res, 401, { errorMessages: ['Client must be authenticated to access this resource.'], errors: {} });
        }
        const errors = checkJiraBody(body, options.jira.projects);
        if (Object.keys(errors).length) return send(res, 400, { errorMessages: [], errors });
        accepted.jira.push(body);
        const project = ((body as { fields: { project: { key: string } } }).fields.project.key);
        const n = nextIssue++;
        return send(res, 201, { id: String(10000 + n), key: project + '-' + n, self: 'http://mock/rest/api/3/issue/' + (10000 + n) });
      }
      send(res, 404, { error: 'Not found: ' + req.method + ' ' + url });
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: 'http://127.0.0.1:' + port,
    accepted,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
