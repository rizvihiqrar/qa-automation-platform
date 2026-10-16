// Decides go / no-go for a release from the results of earlier checks.

export const DEFAULT_POLICY = {
  requiredChecks: [],
  maxFailedTests: 0,
  maxFlakyTests: 0,
};

export function decide(policyInput, results) {
  const policy = { ...DEFAULT_POLICY, ...policyInput };
  const reasons = [];
  const byName = new Map(results.map((r) => [r.name, r]));

  for (const name of policy.requiredChecks) {
    if (!byName.has(name)) reasons.push(`Required check "${name}" has no result`);
  }

  const blocked = new Set();
  const block = (name, reason) => { blocked.add(name); reasons.push(`${name}: ${reason}`); };

  for (const r of results) {
    if (r.kind === 'tests') {
      // Judge test results by the policy's limits, not by "any failure".
      const { passed, failed, flaky, loadErrors = 0 } = r.counts;
      if (passed + failed + flaky === 0) block(r.name, 'no tests ran');
      if (loadErrors > 0) block(r.name, `${loadErrors} test file(s) failed to load`);
      if (failed > policy.maxFailedTests) block(r.name, `${failed} failed test(s), limit is ${policy.maxFailedTests}`);
      if (flaky > policy.maxFlakyTests) block(r.name, `${flaky} flaky test(s), limit is ${policy.maxFlakyTests}`);
    } else if (!r.passed) {
      block(r.name, r.detail);
    }
  }

  const checks = [
    ...results.map((r) => ({ name: r.name, status: blocked.has(r.name) ? 'fail' : 'pass', detail: r.detail })),
    ...policy.requiredChecks.filter((n) => !byName.has(n)).map((n) => ({ name: n, status: 'missing', detail: 'no result' })),
  ];
  return { decision: reasons.length === 0 ? 'go' : 'no-go', reasons, checks, policy };
}

/**
 * @param {{ decision: string, reasons: string[], checks: Array<{ name: string, status: string, detail: string }> }} outcome
 * @param {{ version?: string }} [options]
 */
export function formatMarkdown({ decision, reasons, checks }, { version } = {}) {
  const lines = [
    `## Release gate${version ? ` for ${version}` : ''}: ${decision === 'go' ? '✅ GO' : '⛔ NO-GO'}`,
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...checks.map((c) => `| ${c.name} | ${c.status} | ${c.detail} |`),
  ];
  if (reasons.length) lines.push('', '**Blocking:**', ...reasons.map((r) => `- ${r}`));
  return lines.join('\n') + '\n';
}
