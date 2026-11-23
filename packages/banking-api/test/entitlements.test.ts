import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, mock, test } from 'node:test';
import { probe, renderReport, type Finding } from '../src/entitlement-check.ts';
import { ACTIONS, MATRIX, can, parseMatrix, parseMatrixText, renderTable, words, type Action, type Matrix } from '../src/entitlements.ts';
import { startApi, startServers, type Api, type Reply } from './helpers.ts';

// Who may do what (BK-R46 to BK-R49): the role-by-action matrix, enforced through the API, and the
// check that finds a permission that is missing or excessive. Each title starts with the rules it checks.

const api = await startApi({ aml: true });
const count = (target: Api, table: string) => Number((target.ledger.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
const written = (target: Api) => ['accounts', 'transfers', 'ledger_entries', 'screening_decisions', 'idempotency_keys'].map((t) => count(target, t));

// Two accounts, the first holding 1,000.00, made with no role (BK-R48: no header, no restriction).
const from = await api.openAccount('CAD', 'Fixture One');
const to = await api.openAccount('CAD', 'Fixture Two');
assert.equal((await api.post(`/accounts/${from}/deposits`, { amount: '1000.00', currency: 'CAD' })).status, 201);

// One valid request for each action, which succeeds for a role that may.
const REQUESTS: Record<Action, (target: Api, headers: Record<string, string>) => Promise<Reply>> = {
  view: (t, h) => t.request('GET', `/accounts/${from}`, undefined, h),
  open_account: (t, h) => t.request('POST', '/accounts', { owner: 'New Customer', currency: 'CAD' }, h),
  deposit: (t, h) => t.request('POST', `/accounts/${from}/deposits`, { amount: '1.00', currency: 'CAD' }, h),
  withdraw: (t, h) => t.request('POST', `/accounts/${from}/withdrawals`, { amount: '1.00', currency: 'CAD' }, h),
  transfer: (t, h) => t.request('POST', '/transfers', { from_account_id: from, to_account_id: to, amount: '1.00', currency: 'CAD' }, h),
  read_audit: (t, h) => t.request('GET', '/screening-decisions', undefined, h),
};
const as = (role: string) => ({ 'X-Role': role });

function forbidden(reply: Reply) {
  assert.equal(reply.status, 403, JSON.stringify(reply.body));
  assert.equal(reply.body.code, 'forbidden');
  assert.equal(typeof reply.body.error, 'string');
}

describe('the matrix file', () => {
  test('BK-R46 the committed matrix is the four roles and six actions the guide shows', () => {
    assert.deepEqual(ACTIONS, ['view', 'open_account', 'deposit', 'withdraw', 'transfer', 'read_audit']);
    assert.deepEqual(Object.keys(MATRIX), ['viewer', 'teller', 'supervisor', 'auditor']);
    assert.deepEqual({ ...MATRIX }, {
      viewer: ['view'],
      teller: ['view', 'open_account', 'deposit', 'withdraw'],
      supervisor: ['view', 'open_account', 'deposit', 'withdraw', 'transfer'],
      auditor: ['view', 'read_audit'],
    });
  });

  test('BK-R46 the table in TECHNICAL.md is the matrix, word for word', () => {
    const guide = readFileSync(new URL('../TECHNICAL.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(guide.includes(renderTable(MATRIX)), 'the guide\'s matrix table differs from src/entitlements.json: run npm run entitlements and paste the table');
  });

  for (const [label, value, message] of [
    ['an unknown action', { roles: { teller: ['view', 'refund'] } }, /unknown action "refund"/],
    ['an action listed twice', { roles: { teller: ['view', 'view'] } }, /twice/],
    ['actions that are not an array', { roles: { teller: 'view' } }, /array/],
    ['no roles at all', { roles: {} }, /at least one role/],
    ['no roles key', { teller: ['view'] }, /expected/],
    ['a role in capitals', { roles: { Teller: ['view'] } }, /lowercase/],
    ['a role with a dash', { roles: { 'head-teller': ['view'] } }, /lowercase/],
    ['nothing', null, /expected/],
  ] as const) {
    test(`BK-R46 a matrix file with ${label} is refused with a message, not read half-way`, () => {
      assert.throws(() => parseMatrix(value), message);
    });
  }

  test('BK-R46 a role written twice in the file is refused: the later one would quietly replace the earlier', () => {
    const twice = '{ "roles": { "teller": ["view", "deposit"], "auditor": ["view"], "teller": ["view"] } }';
    assert.throws(() => parseMatrixText(twice), /the role "teller" appears twice/);
    assert.deepEqual({ ...parseMatrixText('{ "roles": { "teller": ["view"], "auditor": ["view"] } }') }, { teller: ['view'], auditor: ['view'] });
    assert.throws(() => parseMatrixText('{ not json'), /JSON/);
  });

  test('BK-R46 an action is written as words in a message, every underscore turned into a space', () => {
    assert.equal(words('read_audit'), 'read audit');
    assert.equal(words('approve_large_payment' as Action), 'approve large payment');
  });

  test('BK-R46 can() is false for a role that is not in the matrix, and for names an object has anyway', () => {
    for (const role of ['intern', 'Teller', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'teller, supervisor']) {
      for (const action of ACTIONS) assert.equal(can(MATRIX, role, action), false, `${JSON.stringify(role)} may ${action}`);
    }
  });
});

describe('every role and every action, through the API', () => {
  for (const role of Object.keys(MATRIX)) {
    for (const action of ACTIONS) {
      const may = can(MATRIX, role, action);
      test(`BK-R46 ${role} ${may ? 'may' : 'may not'} ${words(action)}`, async () => {
        const before = written(api);
        const reply = await REQUESTS[action](api, as(role));
        if (may) {
          assert.ok(reply.status === 200 || reply.status === 201, `${reply.status} ${JSON.stringify(reply.body)}`);
        } else {
          forbidden(reply);
          assert.match(reply.body.error, new RegExp(`the role ${role} may not ${words(action)}`));
          assert.deepEqual(written(api), before, 'a forbidden request wrote something');
        }
      });
    }
  }
});

const made = await api.post('/transfers', { from_account_id: from, to_account_id: to, amount: '3.00', currency: 'CAD' });
assert.equal(made.status, 201);

describe('every read route is the view action', () => {
  const ROUTES = ['/accounts', `/accounts/${from}`, `/accounts/${from}/entries`, `/transfers/${made.body.id}`];
  for (const path of ROUTES) {
    for (const role of Object.keys(MATRIX)) {
      test(`BK-R46 GET ${path.replace(/\d+/g, ':id')} is ${can(MATRIX, role, 'view') ? 'allowed' : 'refused'} for ${role}`, async () => {
        const reply = await api.request('GET', path, undefined, as(role));
        if (can(MATRIX, role, 'view')) assert.equal(reply.status, 200, JSON.stringify(reply.body));
        else forbidden(reply);
      });
    }
  }
});

describe('authorization comes first', () => {
  test('BK-R47 a role that may not deposit gets 403, not 404, for an account that does not exist', async () => {
    forbidden(await api.request('POST', '/accounts/999999/deposits', { amount: '1.00', currency: 'CAD' }, as('viewer')));
  });

  test('BK-R47 and 403, not 400 or 415, for a body that is not JSON, is the wrong type or has a bad amount', async () => {
    forbidden(await api.request('POST', `/accounts/${from}/deposits`, '{not json', as('viewer')));
    forbidden(await api.request('POST', `/accounts/${from}/deposits`, { amount: '0', currency: 'CAD' }, as('viewer')));
    forbidden(await api.request('POST', `/accounts/${from}/deposits`, { amount: 12.5, currency: 'XXX' }, as('auditor')));
    const wrongType = await fetch(`${api.base}/accounts/${from}/deposits`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Role': 'viewer' }, body: 'x' });
    assert.equal(wrongType.status, 403);
  });

  test('BK-R47 a forbidden request with an Idempotency-Key does not claim the key: the same key works for a role that may', async () => {
    const key = { 'Idempotency-Key': `entitlements-${Date.now()}` };
    const body = { from_account_id: from, to_account_id: to, amount: '2.00', currency: 'CAD' };
    forbidden(await api.request('POST', '/transfers', body, { ...as('teller'), ...key }));
    assert.equal(count(api, 'idempotency_keys'), 0);
    forbidden(await api.request('POST', '/transfers', body, { ...as('teller'), 'Idempotency-Key': 'bad key with spaces' }));
    assert.equal((await api.request('POST', '/transfers', body, { ...as('supervisor'), ...key })).status, 201);
  });

  test('BK-R47 a forbidden payment is not screened: it leaves no audit row', async () => {
    const before = count(api, 'screening_decisions');
    forbidden(await api.request('POST', `/accounts/${from}/withdrawals`, { amount: '20000.00', currency: 'CAD' }, as('viewer')));
    assert.equal(count(api, 'screening_decisions'), before);
  });

  test('BK-R47 a route that does not exist is 404 and a wrong method is 405, for any role (they are about the route, not the person)', async () => {
    const missing = await api.request('GET', '/nothing', undefined, as('viewer'));
    assert.equal(missing.status, 404);
    const wrongMethod = await api.request('PUT', '/accounts', {}, as('viewer'));
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET, POST');
  });
});

describe('the role header', () => {
  test('BK-R48 with no X-Role header everything but the audit record works as before', async () => {
    for (const action of ACTIONS.filter((a) => a !== 'read_audit')) {
      const reply = await REQUESTS[action](api, {});
      assert.ok(reply.status === 200 || reply.status === 201, `${action}: ${reply.status} ${JSON.stringify(reply.body)}`);
    }
  });

  test('BK-R48 the audit record needs the auditor: with no header, or any other role, it is 403', async () => {
    forbidden(await REQUESTS.read_audit(api, {}));
    for (const role of ['viewer', 'teller', 'supervisor']) forbidden(await REQUESTS.read_audit(api, as(role)));
    assert.equal((await REQUESTS.read_audit(api, as('auditor'))).status, 200);
  });

  test('BK-R48 /health answers everyone: no role, every role, and a role that does not exist', async () => {
    for (const headers of [{}, as('viewer'), as('auditor'), as('intern')]) {
      assert.equal((await api.request('GET', '/health', undefined, headers)).status, 200);
    }
  });

  for (const role of ['admin', 'Teller', 'TELLER', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'teller, supervisor', 'a'.repeat(300)]) {
    test(`BK-R48 the role ${JSON.stringify(role.length > 20 ? `${role.slice(0, 8)}... (${role.length} characters)` : role)} is not in the matrix: 403 for every action, even viewing`, async () => {
      for (const action of ACTIONS) {
        const reply = await REQUESTS[action](api, as(role));
        forbidden(reply);
        assert.match(reply.body.error, /an unknown role/);
        assert.ok(!reply.body.error.includes(role.slice(0, 8)) || role.length === 0, 'the reply repeats what the caller sent');
      }
    });
  }

  test('BK-R48 a matrix made as a plain object, not by the file reader, treats "constructor" and "toString" as unknown roles too', async () => {
    const plain = await startApi({ entitlements: { viewer: ['view'] } });
    const id = await plain.openAccount('CAD');
    for (const role of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const reply = await plain.request('GET', `/accounts/${id}`, undefined, as(role));
      forbidden(reply);
      assert.match(reply.body.error, /an unknown role/, `${role} was treated as a role in the matrix`);
    }
    assert.equal((await plain.request('GET', `/accounts/${id}`, undefined, as('viewer'))).status, 200);
  });

  test('BK-R48 an empty X-Role header is a role that does not exist, not "no role"', async () => {
    forbidden(await REQUESTS.view(api, as('')));
  });

  test('BK-R48 the same role sent twice is not a role: it is read as one value with a comma, which is not in the matrix', async () => {
    const headers = new Headers();
    headers.append('X-Role', 'teller');
    headers.append('X-Role', 'teller');
    const res = await fetch(`${api.base}/accounts/${from}`, { headers });
    assert.equal(res.status, 403);
  });
});

describe('the check that finds a missing or excessive permission', () => {
  const diff = (wrong: Matrix): Omit<Finding, 'status'>[] => Object.keys(MATRIX).flatMap((role) => ACTIONS.flatMap((action) => {
    const meant = can(MATRIX, role, action);
    const got = can(wrong, role, action);
    return meant === got ? [] : [{ role, action, problem: (meant ? 'missing' : 'excessive') as Finding['problem'] }];
  }));
  const key = (f: { role: string; action: string; problem: string }) => `${f.problem}:${f.role}:${f.action}`;

  const withAction = (matrix: Matrix, role: string, action: Action): Matrix => ({ ...matrix, [role]: [...matrix[role]!, action] });
  const withoutAction = (matrix: Matrix, role: string, action: Action): Matrix => ({ ...matrix, [role]: matrix[role]!.filter((a) => a !== action) });
  const everything: Matrix = Object.fromEntries(Object.keys(MATRIX).map((role) => [role, [...ACTIONS]]));
  const withoutRole = ({ teller: _gone, ...rest }: Matrix): Matrix => rest;

  const SEEDED: [string, Matrix][] = [
    ['the viewer may deposit', withAction(MATRIX, 'viewer', 'deposit')],
    ['the teller may not open an account', withoutAction(MATRIX, 'teller', 'open_account')],
    ['the teller may transfer', withAction(MATRIX, 'teller', 'transfer')],
    ['the supervisor may not withdraw', withoutAction(MATRIX, 'supervisor', 'withdraw')],
    ['the auditor may withdraw', withAction(MATRIX, 'auditor', 'withdraw')],
    ['the auditor may not read the audit record', withoutAction(MATRIX, 'auditor', 'read_audit')],
    ['the supervisor may read the audit record', withAction(MATRIX, 'supervisor', 'read_audit')],
    ['the viewer may not view', withoutAction(MATRIX, 'viewer', 'view')],
    ['the teller role is missing', withoutRole(MATRIX)],
    ['every role may do everything', everything],
  ];

  test('BK-R49 on the committed matrix the check sends all 24 pairs and finds nothing', async () => {
    const server = await startApi({ aml: true });
    const report = await probe(server.base, MATRIX);
    assert.equal(report.cells, 24);
    assert.deepEqual(report.findings, []);
    assert.match(renderReport(report), /24 role and action pairs sent through the server: every one is as the matrix says/);
  });

  for (const [label, wrong] of SEEDED) {
    test(`BK-R49 seeded: ${label}: the check finds exactly the pairs that differ, and no others`, async () => {
      const meant = diff(wrong);
      assert.ok(meant.length > 0);
      const server = await startApi({ aml: true, entitlements: wrong });
      const report = await probe(server.base, MATRIX);
      assert.deepEqual(report.findings.map(key).sort(), meant.map(key).sort());
    });
  }

  test('BK-R49 all 10 seeded mistakes are found, with the problem named right: missing for a pair that is refused, excessive for one let through', async () => {
    let found = 0;
    for (const [, wrong] of SEEDED) {
      const server = await startApi({ aml: true, entitlements: wrong });
      const report = await probe(server.base, MATRIX);
      if (report.findings.length > 0 && report.findings.every((f) => f.problem !== 'broken')) found++;
    }
    assert.equal(found, SEEDED.length);
  });

  test('BK-R49 a role that is not in the matrix is checked too, and a server that refuses it everywhere passes', async () => {
    const server = await startApi({ aml: true });
    const report = await probe(server.base, MATRIX, ['viewer', 'intern']);
    assert.equal(report.cells, 12);
    assert.deepEqual(report.findings, []);
    const lax = await startApi({ aml: true, entitlements: { ...MATRIX, intern: ['view'] } });
    assert.deepEqual((await probe(lax.base, MATRIX, ['intern'])).findings.map(key), ['excessive:intern:view']);
  });

  test('BK-R49 a server error is reported as broken, not as a missing or an excessive permission', async () => {
    mock.method(console, 'error', () => {});
    try {
      // The probes are 1.00; the set-up deposit is 1,000.00, so only the probes fail.
      const server = await startApi({ screen: async (m) => { if (m.amount === 100n) throw new Error('screening is down'); } });
      const report = await probe(server.base, MATRIX);
      assert.deepEqual(report.findings.map(key).sort(), [
        'broken:supervisor:deposit', 'broken:supervisor:transfer', 'broken:supervisor:withdraw', 'broken:teller:deposit', 'broken:teller:withdraw',
      ]);
      assert.ok(report.findings.every((f) => f.status === 500));
    } finally {
      mock.restoreAll();
    }
  });

  test('BK-R49 the report names each finding with the role, the action and what the server answered', () => {
    const text = renderReport({ roles: ['viewer'], cells: 6, findings: [
      { role: 'viewer', action: 'deposit', problem: 'excessive', status: 201 },
      { role: 'teller', action: 'open_account', problem: 'missing', status: 403 },
    ] });
    assert.match(text, /6 role and action pairs sent through the server: 2 differ from the matrix/);
    assert.match(text, /excessive\s+viewer may not deposit \(the server answered 201\)/);
    assert.match(text, /missing\s+teller may open_account \(the server answered 403\)/);
  });

  test('BK-R49 a real node src/server.ts process passes the same check', async () => {
    const servers = await startServers(1);
    const report = await probe(servers.bases[0]!, MATRIX);
    assert.equal(report.cells, 24);
    assert.deepEqual(report.findings, []);
  });

  // A stand-in server: it sets up with no role as the real one does, and answers every request that
  // carries a role the way the test says, so the check's reading of each kind of answer can be seen.
  async function standIn(answer: [status: number, body: unknown]): Promise<string> {
    let next = 1;
    const server = createServer((req, res) => {
      req.resume();
      const [status, body] = req.headers['x-role'] === undefined ? [201, { id: next++ }] : answer;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    after(() => { server.close(); });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  test('BK-R49 a server that answers every pair with an error: all 24 are broken, even the pairs the matrix refuses', async () => {
    const report = await probe(await standIn([500, { error: 'down', code: 'internal' }]), MATRIX);
    assert.equal(report.findings.length, 24);
    assert.ok(report.findings.every((f) => f.problem === 'broken' && f.status === 500));
  });

  test('BK-R49 a 403 with another code is not a refusal by the matrix: allowed pairs are broken, refused pairs excessive', async () => {
    const report = await probe(await standIn([403, { error: 'blocked by a firewall', code: 'waf' }]), MATRIX);
    assert.equal(report.findings.length, 24);
    for (const f of report.findings) assert.equal(f.problem, can(MATRIX, f.role, f.action) ? 'broken' : 'excessive', `${f.role} ${f.action}`);
  });

  test('BK-R49 a server that lets every request through: every pair the matrix refuses is excessive and none is missing', async () => {
    const report = await probe(await standIn([200, {}]), MATRIX);
    assert.equal(report.findings.length, 24 - Object.values(MATRIX).reduce((n, actions) => n + actions.length, 0));
    assert.ok(report.findings.every((f) => f.problem === 'excessive'));
  });

  // Not spawnSync: the servers these runs check live in this process, which must stay free to answer them.
  function runReport(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['src/entitlement-report.ts', ...args], { cwd: new URL('..', import.meta.url) });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (status) => resolve({ status, stdout, stderr }));
    });
  }

  test('BK-R49 npm run entitlements -- --matrix <file> compares the server with a matrix you meant: a difference prints the pair and exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banking-entitlements-'));
    try {
      const file = join(dir, 'meant.json');
      const meant = { roles: { ...MATRIX, teller: MATRIX.teller!.filter((a) => a !== 'open_account') } };
      writeFileSync(file, JSON.stringify(meant));
      const run = await runReport('--matrix', file);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      assert.match(run.stdout, /1 differ from the matrix/);
      assert.match(run.stdout, /excessive\s+teller may not open_account \(the server answered 201\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('BK-R49 a matrix file that cannot be read, or arguments that make no sense, exit 2 with a message', async () => {
    const missing = await runReport('--matrix', 'no-such-file.json');
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /cannot read the matrix/);
    const bad = await runReport('--nonsense');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /usage/);
    const dir = mkdtempSync(join(tmpdir(), 'banking-entitlements-'));
    try {
      writeFileSync(join(dir, 'bad.json'), JSON.stringify({ roles: { teller: ['refund'] } }));
      const unknown = await runReport('--matrix', join(dir, 'bad.json'));
      assert.equal(unknown.status, 2);
      assert.match(unknown.stderr, /unknown action "refund"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('BK-R49 npm run entitlements -- --url <base> checks a server that is already running: a wrong server exits 1, the right one 0', async () => {
    const wrong = await startApi({ aml: true, entitlements: { ...MATRIX, viewer: ['view', 'deposit'] } });
    const bad = await runReport('--url', wrong.base);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /excessive\s+viewer may not deposit \(the server answered 201\)/);
    const right = await startApi({ aml: true });
    assert.equal((await runReport('--url', `${right.base}/`)).status, 0);
  });

  test('BK-R49 a server that cannot be reached is exit 2 with a message, not a difference (exit 1)', async () => {
    const run = await runReport('--url', 'http://127.0.0.1:1');
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stderr, /could not run the check against http:\/\/127\.0\.0\.1:1/);
  });

  test('BK-R49 a matrix file with a role written twice is exit 2', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banking-entitlements-'));
    try {
      writeFileSync(join(dir, 'twice.json'), '{ "roles": { "teller": ["view"], "teller": ["view", "deposit"] } }');
      const run = await runReport('--matrix', join(dir, 'twice.json'));
      assert.equal(run.status, 2);
      assert.match(run.stderr, /appears twice/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('BK-R49 npm run entitlements prints the matrix and exits 0 when the server follows it', async () => {
    const run = await runReport();
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(renderTable(MATRIX)));
    assert.match(run.stdout, /every one is as the matrix says/);
  });
});
