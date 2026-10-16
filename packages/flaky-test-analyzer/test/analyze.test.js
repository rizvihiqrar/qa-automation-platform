import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, collectTests } from '../src/analyze.js';
import { toMarkdown } from '../src/report.js';

// Builds a minimal Playwright JSON report with one spec and the given test statuses.
const report = (statuses, title = 'checkout works', file = 'tests/checkout.spec.js') => ({
  suites: [
    {
      file,
      specs: [{ title, file, tests: statuses.map((status) => ({ status, projectName: 'chromium' })) }],
      suites: [],
    },
  ],
});

test('collectTests flattens nested suites and includes the project name', () => {
  const nested = {
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
  assert.equal(tests[0].id, 'a.spec.js > inner [firefox]');
});

test('a test that always passes is stable with zero flake rate', () => {
  const [row] = analyze([report(['expected']), report(['expected']), report(['expected'])]);
  assert.equal(row.label, 'stable');
  assert.equal(row.flakeRate, 0);
  assert.equal(row.passed, 3);
});

test('a test that needs a retry in some runs is flaky with the right rate', () => {
  const [row] = analyze([report(['expected']), report(['flaky']), report(['expected']), report(['flaky'])]);
  assert.equal(row.label, 'flaky');
  assert.equal(row.runs, 4);
  assert.equal(row.flaky, 2);
  assert.equal(row.flakeRate, 0.5);
});

test('a test that passes in some runs and fails in others counts as flaky', () => {
  const [row] = analyze([report(['expected']), report(['unexpected']), report(['expected'])]);
  assert.equal(row.label, 'flaky');
  assert.equal(row.failed, 1);
  assert.ok(Math.abs(row.flakeRate - 1 / 3) < 1e-9);
});

test('a test that fails every run is labelled failing, not flaky', () => {
  const [row] = analyze([report(['unexpected']), report(['unexpected'])]);
  assert.equal(row.label, 'failing');
  assert.equal(row.flakeRate, 0);
});

test('skipped results are not counted', () => {
  const [row] = analyze([report(['skipped']), report(['expected'])]);
  assert.equal(row.runs, 1);
});

test('rows are sorted with the least stable tests first', () => {
  const rows = analyze([
    { suites: [{ file: 'b.spec.js', specs: [
      { title: 'steady', file: 'b.spec.js', tests: [{ status: 'expected', projectName: 'c' }] },
      { title: 'shaky', file: 'b.spec.js', tests: [{ status: 'flaky', projectName: 'c' }] },
    ], suites: [] }] },
  ]);
  assert.match(rows[0].id, /shaky/);
});

test('toMarkdown renders a header, divider and one row per test', () => {
  const md = toMarkdown(analyze([report(['flaky']), report(['expected'])]));
  const lines = md.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[2], /\| 50% \| flaky \|$/);
});
