import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide } from '../src/gate.js';
import { applyChange } from '../src/change.js';
import { fromReadiness, formatPage, requirementStatus, validateReadiness, openDefectCounts } from '../src/readiness.js';
import { parseArgs } from '../src/cli.js';
import { buildPages, PAGE_DAY } from '../examples/build-memos.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const here = (...p) => fileURLToPath(new URL(path.posix.join('..', ...p), import.meta.url));

const t = (id, status = 'pass') => ({ id, status });
const good = (extra = {}) => ({
  requirements: [{ id: 'R1', title: 'List products', tests: [t('T1'), t('T2')] }, { id: 'R2', title: 'Filter', tests: [t('T3')] }],
  defects: [],
  security: { audit: { status: 'pass', detail: '0 vulnerabilities' }, zap: { status: 'pass', detail: '0 high alerts' } },
  ...extra,
});
const check = (results, name) => results.find((r) => r.name === name);
const rel = { version: '2.0.0', date: '2026-11-22' };
const gateOutcome = (data, policy = {}) => decide({ requiredChecks: ['requirements', 'open-defects', 'security'], ...policy }, fromReadiness(data, policy));

test('a requirement is covered only by a passing test: failing, none, or only quarantined is not', () => {
  assert.equal(requirementStatus({ tests: [t('a'), t('b')] }), 'covered');
  assert.equal(requirementStatus({ tests: [t('a'), t('b', 'fail')] }), 'failing');
  assert.equal(requirementStatus({ tests: [] }), 'not tested');
  assert.equal(requirementStatus({ tests: [t('a', 'quarantined')] }), 'not tested');
  assert.equal(requirementStatus({ tests: [t('a'), t('b', 'quarantined')] }), 'covered');
  assert.equal(requirementStatus({ tests: [t('a', 'quarantined'), t('b', 'fail')] }), 'failing');
});

test('the requirements check names the failing and the untested ones', () => {
  const data = good({ requirements: [{ id: 'R1', title: 'a', tests: [t('x')] }, { id: 'R2', title: 'b', tests: [t('y', 'fail')] }, { id: 'R3', title: 'c', tests: [] }] });
  const r = check(fromReadiness(data), 'requirements');
  assert.equal(r.passed, false);
  assert.equal(r.detail, '1/3 requirements covered; failing: R2; not tested: R3');
  assert.equal(check(fromReadiness(good()), 'requirements').detail, '2/2 requirements covered');
});

test('open defects: critical and high default to zero, closed ones do not count', () => {
  let n = 0;
  const d = (severity, status = 'open') => ({ id: `D-${++n}`, title: 'x', severity, status });
  assert.equal(check(fromReadiness(good({ defects: [d('high', 'closed'), d('critical', 'closed')] })), 'open-defects').passed, true);
  assert.equal(check(fromReadiness(good({ defects: [d('high')] })), 'open-defects').detail, '1 open high (limit 0)');
  assert.equal(check(fromReadiness(good({ defects: [d('critical')] })), 'open-defects').passed, false);
  assert.equal(check(fromReadiness(good({ defects: [d('medium'), d('medium'), d('low')] })), 'open-defects').passed, true);
});

test('the policy limits replace the defaults: medium can be limited and high can be allowed', () => {
  const d = (severity) => ({ id: `D-${severity}`, title: 'x', severity, status: 'open' });
  const data = good({ defects: [d('medium'), { ...d('medium'), id: 'D2' }] });
  assert.equal(check(fromReadiness(data, { maxOpenDefects: { medium: 1 } }), 'open-defects').detail, '2 open medium (limit 1)');
  assert.equal(check(fromReadiness(data, { maxOpenDefects: { medium: 2 } }), 'open-defects').passed, true);
  assert.equal(check(fromReadiness(good({ defects: [d('high')] }), { maxOpenDefects: { high: 1 } }), 'open-defects').passed, true);
  assert.deepEqual(openDefectCounts(data), { critical: 0, high: 0, medium: 2, low: 0 });
});

test('security needs both scans to pass, and a scan that was not reported is a failure, not a pass', () => {
  assert.equal(check(fromReadiness(good()), 'security').passed, true);
  const noZap = good(); delete noZap.security.zap;
  assert.equal(check(fromReadiness(noZap), 'security').detail, 'zap was not reported');
  const bad = good({ security: { audit: { status: 'fail', detail: '1 high' }, zap: { status: 'pass', detail: 'ok' } } });
  assert.equal(check(fromReadiness(bad), 'security').detail, 'audit failed');
  const none = good({ security: {} });
  assert.equal(check(fromReadiness(none), 'security').detail, 'audit was not reported; zap was not reported');
});

test('the readiness file is checked and the message names the field', () => {
  assert.throws(() => validateReadiness(null), /must be a JSON object/);
  assert.throws(() => validateReadiness(good({ requirements: [] })), /"requirements" must list at least one/);
  assert.throws(() => validateReadiness(good({ requirements: [{ id: 'R1' }] })), /requirements\[0\] needs an "id" and a "title"/);
  assert.throws(() => validateReadiness(good({ requirements: [{ id: 'R1', title: 'a' }] })), /requirement R1: "tests" must be a list/);
  assert.throws(() => validateReadiness(good({ requirements: [{ id: 'R1', title: 'a', tests: [{ id: 'T', status: 'skipped' }] }] })), /requirement R1, test T: "status" must be one of pass, fail, quarantined/);
  assert.throws(() => validateReadiness(good({ defects: 'none' })), /"defects" must be a list/);
  assert.throws(() => validateReadiness(good({ defects: [{ id: 'D', title: 'x', severity: 'urgent', status: 'open' }] })), /defect D: "severity" must be one of critical, high, medium, low/);
  assert.throws(() => validateReadiness(good({ defects: [{ id: 'D', title: 'x', severity: 'low', status: 'wip' }] })), /defect D: "status" must be open or closed/);
  assert.throws(() => validateReadiness(good({ security: null })), /"security" must have/);
  assert.throws(() => validateReadiness(good({ security: [] })), /"security" must have/);
  assert.throws(() => validateReadiness(good({ requirements: [{ id: 'R1', title: 'a', tests: [t('T1')] }, { id: 'R1', title: 'b', tests: [t('T2')] }] })), /requirement id R1 is used twice/);
  assert.throws(() => validateReadiness(good({ requirements: [{ id: 'R1', title: 'a', tests: [t('T1')] }, { id: 'R2', title: 'b', tests: [t('T1', 'fail')] }] })), /test id T1 is used twice/);
  assert.throws(() => validateReadiness(good({ defects: [{ id: 'D1', title: 'a', severity: 'low', status: 'open' }, { id: 'D1', title: 'b', severity: 'low', status: 'closed' }] })), /defect id D1 is used twice/);
  assert.throws(() => validateReadiness(good({ security: { audit: { status: 'maybe', detail: 'x' } } })), /security\.audit needs a "status" of pass or fail/);
});

test('the page says what the gate says: GO on a clean release', () => {
  const page = formatPage(gateOutcome(good()), good(), rel);
  assert.match(page, /class="banner go">✅ GO/);
  assert.doesNotMatch(page, /<h2>Why<\/h2>/);
});

test('the page cannot say GO when the gate says NO-GO, even when every readiness check is clean', () => {
  const failedSmoke = decide({}, [
    { name: 'smoke', kind: 'tests', passed: false, detail: '1/3', counts: { passed: 1, failed: 2, flaky: 0 } },
    ...fromReadiness(good()),
  ]);
  const page = formatPage(failedSmoke, good(), rel);
  assert.match(page, /class="banner nogo">⛔ NO-GO/);
  assert.doesNotMatch(page, /class="banner go"/);
  assert.match(page, /<h2>Why<\/h2>[\s\S]*smoke: 2 failed test\(s\), limit is 0/);
});

test('every piece of text from the files is escaped, so a title cannot add markup', () => {
  const evil = '<script>alert(1)</script> & "quoted"';
  const data = good({
    requirements: [{ id: 'R<1>', title: evil, tests: [t('T"1', 'quarantined'), t('T2')] }],
    defects: [{ id: 'D1', title: evil, severity: 'low', status: 'open' }],
    security: { audit: { status: 'pass', detail: evil }, zap: { status: 'pass', detail: 'ok' } },
  });
  const page = formatPage(gateOutcome(data), data, { version: '<b>1</b>', date: evil });
  assert.doesNotMatch(page, /<script>alert/);
  assert.doesNotMatch(page, /<b>1<\/b>/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot;/);
  assert.match(page, /<title>Release readiness &lt;b&gt;1&lt;\/b&gt;<\/title>/);
});

test('quarantined tests are listed with their requirement, and the section says None when there are none', () => {
  const data = good({ requirements: [{ id: 'R1', title: 'List', tests: [t('T1'), t('T9', 'quarantined')] }] });
  assert.match(formatPage(gateOutcome(data), data, rel), /<td>T9<\/td><td>R1 List<\/td>/);
  assert.match(formatPage(gateOutcome(good()), good(), rel), /<h2>Quarantined tests<\/h2>\n<p class="muted">None\.<\/p>/);
});

test('open defects are counted by severity and listed; closed ones are not listed', () => {
  const data = good({ defects: [{ id: 'D1', title: 'Open one', severity: 'medium', status: 'open' }, { id: 'D2', title: 'Shut one', severity: 'high', status: 'closed' }] });
  const page = formatPage(gateOutcome(data), data, rel);
  assert.match(page, /<td>medium<\/td><td>1<\/td>/);
  assert.match(page, /<td>high<\/td><td>0<\/td>/);
  assert.match(page, /<li>D1 \(medium\): Open one<\/li>/);
  assert.doesNotMatch(page, /Shut one/);
});

test('a status is a word as well as a colour', () => {
  const data = good({ requirements: [{ id: 'R1', title: 'a', tests: [t('x', 'fail')] }, { id: 'R2', title: 'b', tests: [] }, { id: 'R3', title: 'c', tests: [t('y')] }] });
  const page = formatPage(gateOutcome(data), data, rel);
  for (const word of ['Failing', 'Not tested', 'Covered']) assert.match(page, new RegExp(`class="chip (ok|bad|warn)">${word}<`), word);
});

test('the page shows the change type, and flags an overdue review only when it is told today\'s date', () => {
  const change = { type: 'emergency', requestedAt: '2026-11-20T09:00Z', plannedFor: '2026-11-20T10:00Z', approvedBy: 'On-call', reason: 'A partner goes live.' };
  const outcome = applyChange(gateOutcome(good()), {}, change);
  assert.match(formatPage(outcome, good(), rel, { today: '2026-11-25' }), /<strong>emergency change\.<\/strong>/);
  assert.doesNotMatch(formatPage(outcome, good(), rel, { today: '2026-11-25' }), /Late/);
  assert.match(formatPage(outcome, good(), rel, { today: '2026-11-26' }), /A review of this change is owed by 2026-11-25\. <span class="chip bad">Late<\/span>/);
  assert.doesNotMatch(formatPage(outcome, good(), rel), /Late/);
  const done = applyChange(gateOutcome(good()), {}, { ...change, reviewDoneOn: '2026-11-24' });
  assert.doesNotMatch(formatPage(done, good(), rel, { today: '2027-01-01' }), /Late/);
  assert.doesNotMatch(formatPage(gateOutcome(good()), good(), rel), /<h2>Change type/);
});

test('the page is one self-contained file: no links, scripts or outside resources', () => {
  const page = formatPage(gateOutcome(good()), good(), rel);
  assert.doesNotMatch(page, /https?:\/\/|<script|<link|<img|src=|href=/);
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /name="viewport"/);
  assert.match(page, /prefers-color-scheme:dark/);
});

test('the committed example pages equal what the code builds (run node examples/build-memos.js after a change)', () => {
  for (const [file, text] of Object.entries(buildPages())) {
    assert.equal(fs.readFileSync(here('examples', 'pages', file), 'utf8').replace(/\r\n/g, '\n'), text, `${file} is out of date: run node examples/build-memos.js`);
  }
});

test('the example pages: 1.4.0 is NO-GO for three reasons and 1.4.1 is GO', () => {
  const pages = buildPages();
  assert.match(pages['1.4.0.html'], /class="banner nogo"/);
  for (const reason of ['api-contract: 18/20', 'requirements: 3/4 requirements covered; failing: REQ-3', 'open-defects: 1 open high (limit 0)']) assert.ok(pages['1.4.0.html'].includes(reason), reason);
  assert.match(pages['1.4.1.html'], /class="banner go"/);
  assert.equal(PAGE_DAY, '2026-11-22');
});

// The command line, with real files.
const smoke = ['--playwright', `smoke-tests=${here('test', 'fixtures', 'smoke-playwright.json')}`];
const contract = ['--check', `api-contract=${here('examples', 'contract-1.4.1.json')}`];
/** @param {{ readiness?: string, extra?: string[] }} [options] */
function runCli({ readiness, extra = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-'));
  const out = { memo: path.join(dir, 'memo.md'), page: path.join(dir, 'page.html') };
  const args = [CLI, '--policy', here('examples', 'policy-readiness.json'), ...smoke, ...contract,
    '--k6', `performance=${here('test', 'fixtures', 'k6-load.json')}`,
    '--release', here('examples', 'release-1.4.1.json'), '--memo', out.memo,
    '--readiness', readiness ?? here('examples', 'readiness-1.4.1.json'), '--page', out.page, ...extra];
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { res, page: fs.existsSync(out.page) ? fs.readFileSync(out.page, 'utf8') : null };
}

test('command line: a clean release writes the page and exits 0', () => {
  const { res, page } = runCli();
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /\| requirements \| pass \|/);
  assert.match(page, /class="banner go"/);
});

test('command line: a release with an open high defect exits 1 and the page says NO-GO with the reason', () => {
  const { res, page } = runCli({ readiness: here('examples', 'readiness-1.4.0.json') });
  assert.equal(res.status, 1);
  assert.match(page, /class="banner nogo"/);
  assert.match(page, /open-defects: 1 open high \(limit 0\)/);
});

test('command line: a readiness file that does not exist fails the gate with its own check and writes no page', () => {
  const { res, page } = runCli({ readiness: path.join(os.tmpdir(), 'no-such-readiness.json') });
  assert.equal(res.status, 2);
  assert.match(res.stdout, /\| readiness \| fail \| result file not found/);
  assert.equal(page, null);
});

test('command line: a readiness file with a bad field fails the gate, names the field, and writes no page', () => {
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-bad-')), 'r.json');
  fs.writeFileSync(bad, JSON.stringify({ ...good(), defects: [{ id: 'D', title: 'x', severity: 'urgent', status: 'open' }] }));
  const { res, page } = runCli({ readiness: bad });
  assert.equal(res.status, 2);
  assert.match(res.stdout, /\| readiness \| fail \| readiness file: defect D: "severity"/);
  assert.equal(page, null);
});

test('command line: --today makes a late review show on the page', () => {
  const { page } = runCli({ extra: ['--today', '2026-12-30'] });
  assert.match(page, /chip bad">Late</);
  assert.doesNotMatch(runCli().page, /Late/);
});

test('arguments: the page needs the readiness file and the release file', () => {
  assert.throws(() => parseArgs([...contract, '--readiness', 'r.json']), /--readiness and --page go together/);
  assert.throws(() => parseArgs([...contract, '--page', 'p.html']), /--readiness and --page go together/);
  assert.throws(() => parseArgs([...contract, '--readiness', 'r.json', '--page', 'p.html']), /--page needs --release too/);
  assert.throws(() => parseArgs([...contract, '--readiness']), /--readiness needs a file path/);
  assert.throws(() => parseArgs([...contract, '--today', '22/11/2026']), /--today needs a date such as 2026-11-22/);
  assert.throws(() => parseArgs([...contract, '--today', '2026-02-31']), /--today needs a date/);
  assert.doesNotThrow(() => parseArgs([...contract, '--today', '2026-11-22']));
  assert.doesNotThrow(() => parseArgs(['--readiness', 'r.json', '--page', 'p.html', '--release', 'a.json', '--memo', 'm.md']));
});
