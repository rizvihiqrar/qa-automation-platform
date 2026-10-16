// Reads Playwright JSON reports (from `--reporter=json`) and reports how often
// each test passed, needed a retry, or failed across runs.

const STATUS_BUCKET = { expected: 'passed', flaky: 'flaky', unexpected: 'failed' };

// Flattens a Playwright JSON report into one entry per test per project.
export function collectTests(report) {
  const out = [];
  const walk = (suite, file) => {
    for (const child of suite.suites ?? []) walk(child, child.file ?? file);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        out.push({
          id: `${spec.file ?? file} > ${spec.title} [${test.projectName ?? 'default'}]`,
          status: test.status,
        });
      }
    }
  };
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  return out;
}

// Labels a row:
//   failing - failed in every run
//   flaky   - needed a retry at least once, or passed and failed across runs
//   stable  - the same result every run
export function classify(row) {
  const label =
    row.failed === row.runs ? 'failing'
    : row.flaky > 0 || (row.failed > 0 && row.passed > 0) ? 'flaky'
    : 'stable';
  // Share of runs where the test needed a retry or failed outright
  // while still passing somewhere else, so mixed results count as flaky.
  const unstableRuns = label === 'flaky' ? row.flaky + row.failed : 0;
  return { ...row, label, flakeRate: row.runs ? unstableRuns / row.runs : 0 };
}

// Aggregates any number of reports into one row per test, most unstable first.
export function analyze(reports) {
  const byTest = new Map();
  for (const report of reports) {
    for (const { id, status } of collectTests(report)) {
      const bucket = STATUS_BUCKET[status];
      if (!bucket) continue; // skipped tests are not counted
      const row = byTest.get(id) ?? { id, runs: 0, passed: 0, flaky: 0, failed: 0 };
      row.runs += 1;
      row[bucket] += 1;
      byTest.set(id, row);
    }
  }
  return [...byTest.values()]
    .map(classify)
    .sort((a, b) => b.flakeRate - a.flakeRate || a.id.localeCompare(b.id));
}
