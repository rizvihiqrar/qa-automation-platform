import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, collectTests, type PlaywrightReport, type PlaywrightTest } from '../src/analyze.ts';
import { toMarkdown } from '../src/report.ts';

type Status = PlaywrightTest['status'];

// Builds a minimal Playwright JSON report with one spec and the given test statuses.
const report = (statuses: Status[], title = 'checkout works', file = 'tests/checkout.spec.js'): PlaywrightReport => ({
  suites: [
    {
      file,
      specs: [{ title, file, tests: statuses.map((status) => ({ status, projectName: 'chromium' })) }],
      suites: [],
    },
  ],
});

// The single row produced by analyzing these reports.
const onlyRow = (reports: PlaywrightReport[]) => {
  const rows = analyze(reports);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.ok(row);
  return row;
};

test('collectTests flattens nested suites and includes the project name', () => {
  const nested: PlaywrightReport = {
    suites: [
      {
        file: 'a.spec.js',
        specs: [],
        suites: [{ file: 'a.spec.js', specs: [{ title: 'inner', file: 'a.spec.js', tests: [{ status: 'expected', projectName: 'firefox' }] }], suites: [] }],
      },
    ],
  };
  const tests = collectTests(nested);
  assert.equal(tests.length, 1);
  assert.equal(tests[0]?.id, 'a.spec.js > inner [firefox]');
});

test('a test that always passes is stable with zero flake rate', () => {
  const row = onlyRow([report(['expected']), report(['expected']), report(['expected'])]);
  assert.equal(row.label, 'stable');
  assert.equal(row.flakeRate, 0);
  assert.equal(row.passed, 3);
});

test('a test that needs a retry in some runs is flaky with the right rate', () => {
  const row = onlyRow([report(['expected']), report(['flaky']), report(['expected']), report(['flaky'])]);
  assert.equal(row.label, 'flaky');
  assert.equal(row.runs, 4);
  assert.equal(row.flaky, 2);
  assert.equal(row.flakeRate, 0.5);
});

test('a test that passes in some runs and fails in others counts as flaky', () => {
  const row = onlyRow([report(['expected']), report(['unexpected']), report(['expected'])]);
  assert.equal(row.label, 'flaky');
  assert.equal(row.failed, 1);
  assert.ok(Math.abs(row.flakeRate - 1 / 3) < 1e-9);
});

test('a test that fails every run is labelled failing, not flaky', () => {
  const row = onlyRow([report(['unexpected']), report(['unexpected'])]);
  assert.equal(row.label, 'failing');
  assert.equal(row.flakeRate, 0);
});

test('skipped results are not counted', () => {
  assert.equal(onlyRow([report(['skipped']), report(['expected'])]).runs, 1);
});

test('rows are sorted with the least stable tests first', () => {
  const rows = analyze([
    { suites: [{ file: 'b.spec.js', specs: [
      { title: 'steady', file: 'b.spec.js', tests: [{ status: 'expected', projectName: 'c' }] },
      { title: 'shaky', file: 'b.spec.js', tests: [{ status: 'flaky', projectName: 'c' }] },
    ], suites: [] }] },
  ]);
  assert.match(rows[0]?.id ?? '', /shaky/);
});

test('toMarkdown renders a header, divider and one row per test', () => {
  const md = toMarkdown(analyze([report(['flaky']), report(['expected'])]));
  const lines = md.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[2] ?? '', /\| 50% \| flaky \|$/);
});
