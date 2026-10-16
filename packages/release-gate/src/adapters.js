// Turn each tool's output into one shape the gate understands:
// { name, kind, passed, detail, counts? }

// Playwright JSON reporter output. A flaky test passed only after a retry.
export function fromPlaywright(name, report) {
  const s = report.stats ?? {};
  const loadErrors = (report.errors ?? []).length;
  const counts = { passed: s.expected ?? 0, failed: s.unexpected ?? 0, flaky: s.flaky ?? 0, skipped: s.skipped ?? 0, loadErrors };
  const total = counts.passed + counts.failed + counts.flaky;
  return {
    name,
    kind: 'tests',
    passed: counts.failed === 0 && loadErrors === 0 && total > 0,
    counts,
    detail: total === 0
      ? `no tests ran${loadErrors ? ` (${loadErrors} load error(s))` : ''}`
      : `${counts.passed}/${total} passed, ${counts.failed} failed, ${counts.flaky} flaky`,
  };
}

// k6 summary JSON (from handleSummary). Passes only if every threshold passed.
export function fromK6(name, summary) {
  const failed = [];
  let total = 0;
  for (const [metric, value] of Object.entries(summary.metrics ?? {})) {
    for (const [rule, result] of Object.entries(value.thresholds ?? {})) {
      total += 1;
      if (!result.ok) failed.push(`${metric}: ${rule}`);
    }
  }
  return {
    name,
    kind: 'performance',
    passed: total > 0 && failed.length === 0,
    detail: total === 0 ? 'no thresholds defined' : failed.length ? `failed: ${failed.join('; ')}` : `${total}/${total} thresholds met`,
  };
}

// Any other check that reports { passed: boolean, summary?: string }.
export function fromCheck(name, result) {
  if (typeof result.passed !== 'boolean') throw new Error(`Check "${name}" needs a boolean "passed" field`);
  return { name, kind: 'check', passed: result.passed, detail: result.summary ?? (result.passed ? 'passed' : 'failed') };
}
