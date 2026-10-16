// Formats analyze() output as a Markdown table for PR comments or a README.

export function toMarkdown(rows) {
  const header = '| Test | Runs | Passed | Needed retry | Failed | Flake rate | Status |';
  const divider = '|---|---:|---:|---:|---:|---:|---|';
  const lines = rows.map((r) =>
    `| ${r.id} | ${r.runs} | ${r.passed} | ${r.flaky} | ${r.failed} | ${(r.flakeRate * 100).toFixed(0)}% | ${r.label} |`
  );
  return [header, divider, ...lines].join('\n');
}
