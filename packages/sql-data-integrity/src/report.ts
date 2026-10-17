// Formats check results as plain text (terminal) or Markdown (PR comments, CI summaries).

import { summarizeResults, type CheckResult } from './integrity.ts';

const status = (r: CheckResult) => (r.error ? 'ERROR' : r.rows.length === 0 ? 'pass' : r.severity === 'error' ? 'FAIL' : 'warn');

export function formatText(results: CheckResult[], { maxRows = 5 } = {}): string {
  const s = summarizeResults(results);
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${status(r).padEnd(5)} ${r.id.padEnd(28)} ${r.rows.length ? `${r.rows.length} row(s)` : ''}`.trimEnd());
    if (r.error) lines.push(`      could not run: ${r.error}`);
    for (const row of r.rows.slice(0, maxRows)) {
      lines.push('      ' + r.columns.map((c, i) => `${c}=${row[i]}`).join(', '));
    }
    if (r.rows.length > maxRows) lines.push(`      ... and ${r.rows.length - maxRows} more`);
  }
  lines.push('', `${s.passed}/${s.checks} checks passed, ${s.errors} error(s), ${s.warnings} warning(s), ${s.badRows} bad row(s)`);
  return lines.join('\n');
}

export function formatMarkdown(results: CheckResult[]): string {
  const s = summarizeResults(results);
  const lines = [
    `**${s.passed}/${s.checks} checks passed** · ${s.errors} error(s) · ${s.warnings} warning(s) · ${s.badRows} bad row(s)`,
    '',
    '| Status | Check | Bad rows | Rule |',
    '|---|---|---:|---|',
    ...results.map((r) => `| ${status(r)} | \`${r.id}\` | ${r.rows.length} | ${r.description} |`),
  ];
  return lines.join('\n') + '\n';
}
