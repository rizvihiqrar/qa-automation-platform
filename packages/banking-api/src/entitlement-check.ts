import { ACTIONS, can, type Action, type Matrix } from './entitlements.ts';

// Tests a running server against the matrix a person meant (BK-R49): for every role and every
// action it sends a real request that would succeed if the role were allowed, and compares
// what came back. It finds a permission that is missing (the role may, the server says 403),
// one that is excessive (the role may not, the server lets it through) and one it can't judge
// (a server error). It works over HTTP, so it checks a real server, whatever it was built from.

export type Problem = 'missing' | 'excessive' | 'broken';

export interface Finding {
  role: string;
  action: Action;
  problem: Problem;
  status: number;
}

export interface Report {
  roles: string[];
  cells: number;
  findings: Finding[];
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function send(base: string, method: string, path: string, body?: unknown, role?: string): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = body === undefined ? {} : { ...JSON_HEADERS };
  if (role !== undefined) headers['X-Role'] = role;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Two CAD accounts, the first holding 1,000.00, made with no role (a server that refuses a
// request with no role can't be set up this way, which the report says).
async function fixtures(base: string): Promise<{ from: number; to: number }> {
  const open = async (owner: string) => {
    const made = await send(base, 'POST', '/accounts', { owner, currency: 'CAD' });
    if (made.status !== 201) throw new Error(`could not set up an account without a role: ${made.status} ${JSON.stringify(made.body)}`);
    return made.body.id as number;
  };
  const from = await open('Probe One');
  const to = await open('Probe Two');
  const funded = await send(base, 'POST', `/accounts/${from}/deposits`, { amount: '1000.00', currency: 'CAD' });
  if (funded.status !== 201) throw new Error(`could not fund the probe account: ${funded.status} ${JSON.stringify(funded.body)}`);
  return { from, to };
}

export async function probe(base: string, intended: Matrix, roles: string[] = Object.keys(intended)): Promise<Report> {
  const { from, to } = await fixtures(base);
  const requests: Record<Action, (role: string) => Promise<{ status: number; body: any }>> = {
    view: (role) => send(base, 'GET', `/accounts/${from}`, undefined, role),
    open_account: (role) => send(base, 'POST', '/accounts', { owner: 'Probe', currency: 'CAD' }, role),
    deposit: (role) => send(base, 'POST', `/accounts/${from}/deposits`, { amount: '1.00', currency: 'CAD' }, role),
    withdraw: (role) => send(base, 'POST', `/accounts/${from}/withdrawals`, { amount: '1.00', currency: 'CAD' }, role),
    transfer: (role) => send(base, 'POST', '/transfers', { from_account_id: from, to_account_id: to, amount: '1.00', currency: 'CAD' }, role),
    read_audit: (role) => send(base, 'GET', '/screening-decisions', undefined, role),
  };
  const findings: Finding[] = [];
  let cells = 0;
  for (const role of roles) {
    for (const action of ACTIONS) {
      cells++;
      const reply = await requests[action](role);
      const refused = reply.status === 403 && reply.body?.code === 'forbidden';
      const worked = reply.status === 200 || reply.status === 201;
      if (reply.status >= 500) findings.push({ role, action, problem: 'broken', status: reply.status });
      else if (can(intended, role, action) && !worked) findings.push({ role, action, problem: refused ? 'missing' : 'broken', status: reply.status });
      else if (!can(intended, role, action) && !refused) findings.push({ role, action, problem: 'excessive', status: reply.status });
    }
  }
  return { roles, cells, findings };
}

export function renderReport(report: Report): string {
  const lines = [`${report.cells} role and action pairs sent through the server: ${report.findings.length === 0 ? 'every one is as the matrix says' : `${report.findings.length} differ from the matrix`}`];
  for (const f of report.findings) {
    lines.push(`  ${f.problem.padEnd(9)} ${f.role} may${f.problem === 'excessive' ? ' not' : ''} ${f.action} (the server answered ${f.status})`);
  }
  return lines.join('\n');
}
