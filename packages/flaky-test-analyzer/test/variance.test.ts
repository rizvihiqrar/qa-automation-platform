import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, type PlaywrightReport, type PlaywrightTest } from '../src/analyze.ts';
import { detectionTable, varianceMarkdown, varianceRows } from '../src/variance.ts';

type Status = PlaywrightTest['status'];

// One report as `--repeat-each` writes it: each repeat is another entry in spec.tests.
const repeated = (tests: Record<string, Status[]>): PlaywrightReport => ({
  suites: [
    {
      title: 'cart.spec.js',
      file: 'cart.spec.js',
      suites: [
        {
          title: 'Cart',
          file: 'cart.spec.js',
          specs: Object.entries(tests).map(([title, statuses]) => ({ title, file: 'cart.spec.js', tests: statuses.map((status) => ({ status, projectName: 'chromium' })) })),
        },
      ],
    },
  ],
});
const times = (n: number, status: Status): Status[] => Array<Status>(n).fill(status);

test('a --repeat-each report counts every repeat as a run of the same test', () => {
  const report = varianceRows(analyze([repeated({ adds: [...times(9, 'expected'), 'unexpected'] })]));
  assert.equal(report.tests, 1);
  const [row] = report.rows;
  assert.equal(row?.id, 'cart.spec.js > Cart > adds [chromium]');
  assert.equal(row?.runs, 10);
  assert.equal(row?.firstTry, 9);
  assert.equal(row?.verdict, 'flaky');
  assert.ok(row && row.ci.low < 0.6 && row.ci.high > 0.98, 'one failure in ten leaves a wide interval');
});

test('verdicts: one failure is enough to call a test flaky; always failing is broken; a retry counts as a failure', () => {
  const report = varianceRows(
    analyze([
      repeated({
        rare: [...times(29, 'expected'), 'unexpected'],
        broken: times(5, 'unexpected'),
        retried: times(5, 'flaky'),
        clean: times(5, 'expected'),
      }),
    ]),
  );
  const verdict = Object.fromEntries(report.rows.map((r) => [r.id.split(' > ')[2], r.verdict]));
  assert.deepEqual(verdict, {
    'broken [chromium]': 'failing',
    'retried [chromium]': 'flaky',
    'rare [chromium]': 'flaky',
    'clean [chromium]': 'no failure seen',
  });
  // Lowest pass rate first.
  assert.deepEqual(report.rows.map((r) => r.passRate), [0, 0, 29 / 30, 1]);
  assert.equal(report.executions, 45);
  assert.equal(report.firstTry, 34);
});

test('separate CI runs and repeats in one run add up the same way', () => {
  const runs = [repeated({ adds: ['expected'] }), repeated({ adds: ['unexpected'] }), repeated({ adds: ['expected'] })];
  const once = varianceRows(analyze([repeated({ adds: ['expected', 'unexpected', 'expected'] })]));
  assert.deepEqual(varianceRows(analyze(runs)), once);
});

test('the Markdown lists unstable tests with intervals and says what clean runs do not prove', () => {
  const md = varianceMarkdown(varianceRows(analyze([repeated({ shaky: [...times(9, 'expected'), 'unexpected'], fine: times(10, 'expected'), finer: times(20, 'expected') })])), 14);
  assert.match(md, /Run-to-run variance: 40 runs of 3 tests/);
  assert.match(md, /First-try pass rate across all runs: \*\*97\.5%\*\*/);
  assert.match(md, /\| cart\.spec\.js > Cart > shaky \[chromium\] \| 10 \| 9 \| 90\.0% \| 59\.6%–98\.2% \| flaky \|/);
  assert.match(md, /Never failed: 2/);
  // The weakest claim wins: the test with 10 runs, not 20.
  assert.match(md, /at least 10 times without a failure\. That only shows each one fails less than \*\*25\.9%\*\*/);
  assert.match(md, /1 failure in 20 takes 59 clean runs; 1 in 100 takes 299/);
  assert.match(md, /Chance it passes all 14 runs anyway/);
});

test('with nothing unstable the Markdown says so', () => {
  const md = varianceMarkdown(varianceRows(analyze([repeated({ fine: times(3, 'expected') })])), 3);
  assert.match(md, /Failed at least once: 0\n\nNone\./);
});

test('detectionTable: runs needed and the chance a flaky test slips through the window', () => {
  const rows = detectionTable(14).split('\n').slice(2);
  assert.deepEqual(rows, [
    '| 100 | 299 | 86.9% |',
    '| 50 | 149 | 75.4% |',
    '| 20 | 59 | 48.8% |',
    '| 10 | 29 | 22.9% |',
    '| 5 | 14 | 4.4% |',
  ]);
});
