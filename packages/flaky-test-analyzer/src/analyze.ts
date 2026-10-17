// Reads Playwright JSON reports (from `--reporter=json`) and reports how often
// each test passed, needed a retry, or failed across runs.

/** The parts of Playwright's JSON report this tool reads. */
export interface PlaywrightTest {
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  projectName?: string;
}
export interface PlaywrightSpec {
  title: string;
  file?: string;
  tests?: PlaywrightTest[];
}
export interface PlaywrightSuite {
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}
export interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}

export type Label = 'stable' | 'flaky' | 'failing';

export interface TestRow {
  id: string;
  runs: number;
  passed: number;
  flaky: number;
  failed: number;
  /** Runs where this test needed a retry or failed, oldest first. */
  unstableRuns: string[];
}

/** One run's report, named so results can point back to the run (a CI run ID, a file name). */
export interface NamedReport {
  run: string;
  report: PlaywrightReport;
}
export interface AnalyzedRow extends TestRow {
  label: Label;
  /** Share of runs (0–1) that needed a retry or failed while passing elsewhere. */
  flakeRate: number;
}

type Bucket = 'passed' | 'flaky' | 'failed';
const STATUS_BUCKET: Partial<Record<PlaywrightTest['status'], Bucket>> = { expected: 'passed', flaky: 'flaky', unexpected: 'failed' };

// Flattens a Playwright JSON report into one entry per test per project.
export function collectTests(report: PlaywrightReport): Array<{ id: string; status: PlaywrightTest['status'] }> {
  const out: Array<{ id: string; status: PlaywrightTest['status'] }> = [];
  const walk = (suite: PlaywrightSuite, file: string | undefined): void => {
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
export function classify(row: TestRow): AnalyzedRow {
  const label: Label =
    row.failed === row.runs ? 'failing'
    : row.flaky > 0 || (row.failed > 0 && row.passed > 0) ? 'flaky'
    : 'stable';
  // Share of runs where the test needed a retry or failed outright
  // while still passing somewhere else, so mixed results count as flaky.
  const unstableRuns = label === 'flaky' ? row.flaky + row.failed : 0;
  return { ...row, label, flakeRate: row.runs ? unstableRuns / row.runs : 0 };
}

// Aggregates any number of reports into one row per test, most unstable first.
// Unnamed reports are numbered 1, 2, 3... in the order given.
export function analyze(reports: readonly PlaywrightReport[]): AnalyzedRow[] {
  return analyzeRuns(reports.map((report, i) => ({ run: String(i + 1), report })));
}

// The same, for reports named by run. Pass them oldest first.
export function analyzeRuns(runs: readonly NamedReport[]): AnalyzedRow[] {
  const byTest = new Map<string, TestRow>();
  for (const { run, report } of runs) {
    for (const { id, status } of collectTests(report)) {
      const bucket = STATUS_BUCKET[status];
      if (!bucket) continue; // skipped tests are not counted
      const row = byTest.get(id) ?? { id, runs: 0, passed: 0, flaky: 0, failed: 0, unstableRuns: [] };
      row.runs += 1;
      row[bucket] += 1;
      if (bucket !== 'passed' && !row.unstableRuns.includes(run)) row.unstableRuns.push(run);
      byTest.set(id, row);
    }
  }
  return [...byTest.values()]
    .map(classify)
    .sort((a, b) => b.flakeRate - a.flakeRate || a.id.localeCompare(b.id));
}
