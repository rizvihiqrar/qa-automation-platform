// Run-to-run variance: each test's first-try pass rate with a 95% confidence
// interval, and what a run of clean results does and doesn't rule out. Reads the
// rows from analyze(), so the input can be many CI runs or one report made with
// `--repeat-each` (every repeat counts as a run). Pure; src/variance-cli.ts prints it.
import type { AnalyzedRow } from './analyze.ts';
import { chanceAllPass, runsToDetect, wilson, zeroFailureUpperBound, type Interval } from './stats.ts';

export type Verdict = 'failing' | 'flaky' | 'no failure seen';

export interface VarianceRow {
  id: string;
  runs: number;
  /** Runs that passed without a retry. */
  firstTry: number;
  passRate: number;
  ci: Interval;
  verdict: Verdict;
}

export interface VarianceReport {
  tests: number;
  executions: number;
  firstTry: number;
  ci: Interval;
  rows: VarianceRow[];
}

// A failure in one run and a pass in another, on the same code, is proof of
// flakiness however rare: the statistics only matter for tests that never failed.
export function varianceRows(rows: readonly AnalyzedRow[]): VarianceReport {
  const out = rows.map(({ id, runs, passed, failed }): VarianceRow => ({
    id,
    runs,
    firstTry: passed,
    passRate: runs ? passed / runs : 0,
    ci: wilson(passed, runs),
    verdict: failed === runs ? 'failing' : passed < runs ? 'flaky' : 'no failure seen',
  }));
  out.sort((a, b) => a.passRate - b.passRate || a.id.localeCompare(b.id));
  const executions = out.reduce((n, r) => n + r.runs, 0);
  const firstTry = out.reduce((n, r) => n + r.firstTry, 0);
  return { tests: out.length, executions, firstTry, ci: wilson(firstTry, executions), rows: out };
}

const pct = (x: number): string => {
  const p = x * 100;
  if (p === 0 || p === 100) return `${p}%`;
  return `${p < 1 || p > 99 ? p.toFixed(2) : p.toFixed(1)}%`;
};
const range = (ci: Interval): string => `${pct(ci.low)}–${pct(ci.high)}`;

/** Flake rates for the "how many runs" table: fails 1 run in N. */
export const DETECTION_RATES = [100, 50, 20, 10, 5] as const;

export function detectionTable(window: number, confidence = 0.95): string {
  const lines = [
    `| Test fails 1 run in | Runs for a ${Math.round(confidence * 100)}% chance of seeing it fail | Chance it passes all ${window} runs anyway |`,
    '|---:|---:|---:|',
  ];
  for (const n of DETECTION_RATES) {
    lines.push(`| ${n} | ${runsToDetect(1 / n, confidence)} | ${pct(chanceAllPass(1 / n, window))} |`);
  }
  return lines.join('\n');
}

export function varianceMarkdown(report: VarianceReport, window: number): string {
  const unstable = report.rows.filter((r) => r.verdict !== 'no failure seen');
  const clean = report.rows.filter((r) => r.verdict === 'no failure seen');
  const lines = [
    `## Run-to-run variance: ${report.executions} runs of ${report.tests} tests`,
    '',
    `First-try pass rate across all runs: **${pct(report.executions ? report.firstTry / report.executions : 0)}** (95% CI ${range(report.ci)}).`,
    '',
    `### Failed at least once: ${unstable.length}`,
    '',
  ];
  if (unstable.length === 0) lines.push('None.');
  else {
    lines.push('| Test | Runs | Passed first time | Pass rate | 95% CI | Verdict |', '|---|---:|---:|---:|---:|---|');
    for (const r of unstable) lines.push(`| ${r.id} | ${r.runs} | ${r.firstTry} | ${pct(r.passRate)} | ${range(r.ci)} | ${r.verdict} |`);
  }
  lines.push('', `### Never failed: ${clean.length}`, '');
  if (clean.length) {
    const fewest = Math.min(...clean.map((r) => r.runs));
    const bound = zeroFailureUpperBound(fewest);
    lines.push(
      `Each ran at least ${fewest} times without a failure. That only shows each one fails less than **${pct(bound)}** of the time (95% confidence), not that it never fails. ` +
        `Ruling out 1 failure in 20 takes ${runsToDetect(1 / 20)} clean runs; 1 in 100 takes ${runsToDetect(1 / 100)}.`,
    );
  }
  lines.push('', `### How many runs it takes to catch a flaky test`, '', detectionTable(window));
  return lines.join('\n') + '\n';
}
