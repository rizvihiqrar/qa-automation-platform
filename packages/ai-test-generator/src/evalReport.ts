// Scores an eval run: for each feature, did the generated spec pass review,
// and how many of its tests passed when run? Pure functions, unit-tested.

import path from 'node:path';
import type { Review } from './review.ts';

// The parts of a Playwright JSON report this module reads.
export interface PlaywrightTest { status?: string }
export interface PlaywrightSpec { title?: string; file?: string; tests?: PlaywrightTest[] }
export interface PlaywrightSuite { file?: string; specs?: PlaywrightSpec[]; suites?: PlaywrightSuite[] }
export interface PlaywrightReport { suites?: PlaywrightSuite[] }

export interface RunCounts {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

export interface FeatureResult {
  feature: string;
  review: Review;
  // null when the spec never ran (for example, it didn't load).
  run: RunCounts | null;
}

export interface SummaryRow {
  feature: string;
  reviewPassed: boolean;
  errors: number;
  warnings: number;
  rules: string[];
  ran: boolean;
  tests: number;
  passed: number;
  failed: number;
  clean: boolean;
}

export interface Summary {
  rows: SummaryRow[];
  totals: {
    features: number;
    reviewPassed: number;
    ran: number;
    testsRun: number;
    testsPassed: number;
    clean: number;
    reviewPassRate: number;
    testPassRate: number;
    cleanRate: number;
  };
}

// Removes absolute file paths (which carry the local username) from a parsed
// report before it is saved, so committed runs don't leak machine details.
const LOCAL_PATH = /[A-Za-z]:[\\/][^\s"'`<>|]*|\/(?:home|Users|runner)\/[^\s"'`<>|]*/g;
export function stripLocalPaths<T>(value: T): T {
  if (typeof value === 'string') return value.replace(LOCAL_PATH, '<local-path>') as T;
  if (Array.isArray(value)) return value.map(stripLocalPaths) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripLocalPaths(v)])) as T;
  return value;
}

// Playwright test status -> bucket. A flaky test passed only after a retry.
const BUCKET: Record<string, Exclude<keyof RunCounts, 'total'>> = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };

// Reads a Playwright JSON report into per-file counts, keyed by spec file name.
export function collectRunResults(report: PlaywrightReport): Map<string, RunCounts> {
  const byFile = new Map<string, RunCounts>();
  const walk = (suite: PlaywrightSuite, file: string | undefined) => {
    for (const child of suite.suites ?? []) walk(child, child.file ?? file);
    for (const spec of suite.specs ?? []) {
      const key = path.basename(spec.file ?? file ?? '');
      const counts = byFile.get(key) ?? { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
      for (const test of spec.tests ?? []) {
        const bucket = BUCKET[test.status ?? ''];
        if (!bucket) continue;
        counts.total += 1;
        counts[bucket] += 1;
      }
      byFile.set(key, counts);
    }
  };
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  return byFile;
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

export function summarize(features: FeatureResult[]): Summary {
  const rows = features.map(({ feature, review, run }): SummaryRow => {
    const errors = review.findings.filter((f) => f.severity === 'error').length;
    const warnings = review.findings.filter((f) => f.severity === 'warning').length;
    const allPassed = run !== null && run.total > 0 && run.passed === run.total;
    return {
      feature,
      reviewPassed: review.passed,
      errors,
      warnings,
      rules: [...new Set(review.findings.map((f) => f.rule))],
      ran: run !== null && run.total > 0,
      tests: run?.total ?? 0,
      passed: run?.passed ?? 0,
      failed: run?.failed ?? 0,
      clean: review.passed && warnings === 0 && allPassed,
    };
  });

  const testsRun = rows.reduce((n, r) => n + r.tests, 0);
  const testsPassed = rows.reduce((n, r) => n + r.passed, 0);
  return {
    rows,
    totals: {
      features: rows.length,
      reviewPassed: rows.filter((r) => r.reviewPassed).length,
      ran: rows.filter((r) => r.ran).length,
      testsRun,
      testsPassed,
      clean: rows.filter((r) => r.clean).length,
      reviewPassRate: pct(rows.filter((r) => r.reviewPassed).length, rows.length),
      testPassRate: pct(testsPassed, testsRun),
      cleanRate: pct(rows.filter((r) => r.clean).length, rows.length),
    },
  };
}

export function toMarkdown({ rows, totals }: Summary, { label, model }: { label: string; model: string }): string {
  const lines = [
    `# Eval run: ${label}`,
    '',
    `Model: \`${model}\`. Tests ran once with no retries against the live Sauce Demo site.`,
    '',
    '## Summary',
    '',
    '| Measure | Result |',
    '|---|---|',
    `| Specs that passed review | ${totals.reviewPassed} of ${totals.features} (${totals.reviewPassRate}%) |`,
    `| Generated tests that passed on the first run | ${totals.testsPassed} of ${totals.testsRun} (${totals.testPassRate}%) |`,
    `| Specs usable as-is (clean review, every test passed) | ${totals.clean} of ${totals.features} (${totals.cleanRate}%) |`,
    '',
    '## Per feature',
    '',
    '| Feature | Review | Errors | Warnings | Rules hit | Tests passed |',
    '|---|---|---:|---:|---|---|',
    ...rows.map((r) =>
      `| ${r.feature} | ${r.reviewPassed ? 'pass' : 'FAIL'} | ${r.errors} | ${r.warnings} | ${r.rules.join(', ') || '—'} | ${r.ran ? `${r.passed}/${r.tests}` : 'did not run'} |`
    ),
  ];
  return lines.join('\n') + '\n';
}

// A checklist for the human reviewer: every spec that needs work, with space to
// record what was changed. This is the "what did a person have to fix" record.
export function fixesTemplate({ rows }: Summary, { label }: { label: string }): string {
  const needsWork = rows.filter((r) => !r.clean);
  const lines = [
    `# Human fixes: ${label}`,
    '',
    'Record what had to change before each spec was usable. Keep entries short and specific.',
    '',
  ];
  if (needsWork.length === 0) lines.push('Every spec was usable as generated.');
  for (const r of needsWork) {
    const why = [
      !r.reviewPassed && `review failed (${r.rules.join(', ')})`,
      r.reviewPassed && r.warnings > 0 && `review warnings (${r.rules.join(', ')})`,
      !r.ran && 'did not run',
      r.ran && r.failed > 0 && `${r.failed} of ${r.tests} tests failed`,
    ].filter(Boolean).join('; ');
    lines.push(`## ${r.feature}`, '', `Flagged: ${why}`, '', '- Cause:', '- Change made:', '');
  }
  return lines.join('\n') + '\n';
}
