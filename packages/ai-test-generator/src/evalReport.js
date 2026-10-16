// Scores an eval run: for each feature, did the generated spec pass review,
// and how many of its tests passed when run? Pure functions, unit-tested.

import path from 'path';

// Playwright test status -> bucket. A flaky test passed only after a retry.
const BUCKET = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };

// Reads a Playwright JSON report into per-file counts, keyed by spec file name.
export function collectRunResults(report) {
  const byFile = new Map();
  const walk = (suite, file) => {
    for (const child of suite.suites ?? []) walk(child, child.file ?? file);
    for (const spec of suite.specs ?? []) {
      const key = path.basename(spec.file ?? file ?? '');
      const counts = byFile.get(key) ?? { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
      for (const test of spec.tests ?? []) {
        const bucket = BUCKET[test.status];
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

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 100));

// features: [{ feature, review: { tests, findings, passed }, run: counts | null }]
// run is null when the spec never ran (for example, it didn't load).
export function summarize(features) {
  const rows = features.map(({ feature, review, run }) => {
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

export function toMarkdown({ rows, totals }, { label, model }) {
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
export function fixesTemplate({ rows }, { label }) {
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
