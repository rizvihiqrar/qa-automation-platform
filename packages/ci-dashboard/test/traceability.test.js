import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { planCases, requirements, caseResults, requirementStatus, buildMatrix, renderTraceabilityPage, writeTraceability, inline } from '../src/traceability.js';
import { renderReportsPage } from '../src/reports.js';

const REAL_PLAN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/test-strategy/test-plan.md');

const PLAN = `# Test plan

## Requirements

| ID | Requirement | Risk |
|---|---|---|
| REQ-01 | Price is a number, \`>= 0\` | R-05 |
| REQ-02 | Stock is whole | R-05, R-11 |
| REQ-03 | Orders need a user | R-06 |

## Equivalence partitioning

| ID | Requirement | Input | Expected |
|---|---|---|---|
| TC-EP-01 | REQ-01 | price \`12.5\` | 201 |
| TC-EP-02 | REQ-01 | price \`"12.5"\` | 400 |
| TC-EP-03 | REQ-02 | stock 2.5 | 400 |

## Decision tables

| ID | Requirement | Input | Expected |
|---|---|---|---|
| TC-DT-01 | REQ-03 | no token | 401 |
`;

/** A Playwright JSON report: [title, status] pairs, nested the way Playwright nests them. */
function report(/** @type {Array<[string, string]>} */ tests) {
  const specs = tests.map(([title, status]) => ({ title, tests: [{ status, results: [] }] }));
  return {
    stats: { startTime: '2026-10-17T12:00:00.000Z' },
    suites: [{ title: 'design/x.spec.ts', specs: specs.slice(0, 1), suites: [{ title: 'describe', specs: specs.slice(1), suites: [] }] }],
  };
}

test('planCases reads each case with its requirement and the technique heading it sits under', () => {
  assert.deepEqual(planCases(PLAN).map((c) => [c.id, c.req, c.technique]), [
    ['TC-EP-01', 'REQ-01', 'Equivalence partitioning'],
    ['TC-EP-02', 'REQ-01', 'Equivalence partitioning'],
    ['TC-EP-03', 'REQ-02', 'Equivalence partitioning'],
    ['TC-DT-01', 'REQ-03', 'Decision tables'],
  ]);
  assert.equal(planCases(PLAN)[1].input, 'price `"12.5"`');
});

test('requirements reads the text and every risk', () => {
  assert.deepEqual(requirements(PLAN)[1], { id: 'REQ-02', text: 'Stock is whole', risks: ['R-05', 'R-11'] });
  assert.equal(requirements(PLAN.replace(/\n/g, '\r\n')).length, 3, 'CRLF plan');
});

test('the real plan parses to 12 requirements and 85 cases, every case under a listed requirement', () => {
  const m = buildMatrix(fs.readFileSync(REAL_PLAN, 'utf8'), null);
  assert.equal(m.totals.requirements, 12);
  assert.equal(m.totals.cases, 85);
  assert.deepEqual(m.orphanCases, []);
  assert.equal(m.rows.reduce((n, r) => n + r.cases.length, 0), 85);
});

test('caseResults maps Playwright statuses, walks nested suites and counts tests with no case ID', () => {
  const { byCase, untraced, startedAt } = caseResults(report([
    ['TC-EP-01 price 12.5 is accepted @regression', 'expected'],
    ['TC-EP-02 numeric string', 'unexpected'],
    ['TC-EP-03 fraction', 'flaky'],
    ['TC-DT-01 no token', 'skipped'],
    ['GET /products is public @smoke', 'expected'],
    ['mentions TC-EP-09 but not at the start', 'expected'],
  ]));
  assert.deepEqual(Object.fromEntries([...byCase].map(([id, v]) => [id, v.result])),
    { 'TC-EP-01': 'passed', 'TC-EP-02': 'failed', 'TC-EP-03': 'flaky', 'TC-DT-01': 'skipped' });
  assert.equal(untraced, 2);
  assert.equal(startedAt, '2026-10-17T12:00:00.000Z');
});

test('a case ID used twice keeps the worse result, and an unknown status counts as failed', () => {
  const { byCase } = caseResults(report([['TC-EP-01 a', 'expected'], ['TC-EP-01 b', 'unexpected'], ['TC-EP-02 c', 'interrupted']]));
  assert.deepEqual(byCase.get('TC-EP-01'), { result: 'failed', count: 2 });
  assert.equal(byCase.get('TC-EP-02')?.result, 'failed');
});

test('requirementStatus: failed beats missing, missing beats flaky, and no cases is never passing', () => {
  /** @type {Array<[import('../src/traceability.js').CaseResult[], string]>} */
  const table = [
    [['passed', 'passed'], 'passing'],
    [['passed', 'flaky'], 'flaky'],
    [['passed', 'skipped'], 'incomplete'],
    [['flaky', 'no result'], 'incomplete'],
    [['no result', 'failed'], 'failing'],
    [['passed', 'failed', 'flaky'], 'failing'],
    [[], 'incomplete'],
  ];
  for (const [results, expected] of table) assert.equal(requirementStatus(results), expected, results.join(','));
});

test('buildMatrix: one failed case fails its requirement; a missing result makes it incomplete', () => {
  const m = buildMatrix(PLAN, report([['TC-EP-01 x', 'expected'], ['TC-EP-02 x', 'unexpected'], ['TC-DT-01 x', 'expected']]));
  assert.deepEqual(m.rows.map((r) => [r.id, r.status]), [['REQ-01', 'failing'], ['REQ-02', 'incomplete'], ['REQ-03', 'passing']]);
  assert.equal(m.cases.find((c) => c.id === 'TC-EP-03')?.result, 'no result');
  assert.deepEqual({ ...m.totals }, { requirements: 3, passing: 1, cases: 4, passed: 2, failed: 1, flaky: 0, skipped: 0, 'no result': 1 });
});

test('buildMatrix reports tests naming cases the plan lacks, IDs used twice, and cases citing unknown requirements', () => {
  const plan = PLAN.replace('| TC-DT-01 | REQ-03 |', '| TC-DT-01 | REQ-09 |');
  const m = buildMatrix(plan, report([['TC-EP-01 a', 'expected'], ['TC-EP-01 b', 'expected'], ['TC-EP-99 renamed', 'expected']]));
  assert.deepEqual(m.unplanned, ['TC-EP-99']);
  assert.deepEqual(m.duplicated, ['TC-EP-01']);
  assert.deepEqual(m.orphanCases, ['TC-DT-01']);
  assert.equal(m.rows.find((r) => r.id === 'REQ-03')?.status, 'incomplete', 'a requirement left with no cases');
});

test('with no report, every case has no result and no requirement passes', () => {
  const m = buildMatrix(PLAN, null);
  assert.equal(m.hasResults, false);
  assert.equal(m.totals.passing, 0);
  assert.equal(m.totals['no result'], 4);
});

test('the page escapes plan text, keeps code spans, and links the run and commit', () => {
  assert.equal(inline('a `<b>` & c'), 'a <code>&lt;b&gt;</code> &amp; c');
  const plan = PLAN.replace('Stock is whole', 'Stock <script>alert(1)</script>');
  const html = renderTraceabilityPage(buildMatrix(plan, report([['TC-EP-01 x', 'unexpected']])), {
    repo: 'o/r', generatedAt: '2026-10-17T00:00:00Z', reportHref: '../qa-practice-api/playwright-report/index.html',
    run: { id: 42, number: 7, event: 'push', createdAt: '2026-10-17T00:00:00Z', sha: 'abcdef1234567' },
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<code>&gt;= 0<\/code>/);
  assert.match(html, /actions\/runs\/42">#7<\/a>.*<code>abcdef1<\/code>/);
  assert.match(html, /blob\/abcdef1234567\/docs\/test-strategy\/test-plan\.md/);
  assert.match(html, /<div class="value">0 \/ 3<\/div>/);
  assert.match(html, /class="case critical"[^>]*>TC-EP-01/);
  assert.match(html, /href="\.\.\/qa-practice-api\/playwright-report\/index\.html"/);
  assert.doesNotMatch(html, /Needs attention/);
});

test('the page says so when there are no results or tests name unplanned cases', () => {
  const none = renderTraceabilityPage(buildMatrix(PLAN, null), { repo: 'o/r', run: null, generatedAt: '' });
  assert.match(none, /Needs attention.*No qa-practice-api results were found/s);
  const unplanned = renderTraceabilityPage(buildMatrix(PLAN, report([['TC-EP-77 x', 'expected']])), { repo: 'o/r', run: null, generatedAt: '' });
  assert.match(unplanned, /aren't in the plan: TC-EP-77/);
});

test('writeTraceability writes the page and JSON, and treats a missing or corrupt results file as no results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  const planFile = path.join(dir, 'plan.md');
  fs.writeFileSync(planFile, PLAN);
  const good = path.join(dir, 'results.json');
  fs.writeFileSync(good, JSON.stringify(report([['TC-EP-01 x', 'expected'], ['TC-EP-02 x', 'expected'], ['TC-EP-03 x', 'expected'], ['TC-DT-01 x', 'expected']])));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{ not json');

  const m = writeTraceability({ planFile, resultsFile: good, outDir: path.join(dir, 'out'), repo: 'o/r' });
  assert.equal(m.totals.passing, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'out', 'matrix.json'), 'utf8')).totals.passed, 4);
  assert.match(fs.readFileSync(path.join(dir, 'out', 'index.html'), 'utf8'), /3 \/ 3/);

  for (const resultsFile of [path.join(dir, 'missing.json'), bad, null]) {
    assert.equal(writeTraceability({ planFile, resultsFile, outDir: path.join(dir, 'out2'), repo: 'o/r' }).hasResults, false);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the reports index links the matrix only when one was built', () => {
  const meta = { repo: 'o/r', run: null, generatedAt: '2026-10-17T00:00:00Z' };
  assert.match(renderReportsPage([], { ...meta, traceabilityHref: 'traceability/' }), /<a href="traceability\/">traceability matrix<\/a>/);
  assert.doesNotMatch(renderReportsPage([], meta), /traceability/);
});
