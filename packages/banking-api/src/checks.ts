import { readFileSync, readdirSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

// SQL checks on the ledger itself, not through the API (BK-R26 to BK-R30). Each check
// is a .sql file in sql/checks whose query returns the rows that break one rule, with
// "-- id:", "-- severity:" and "-- description:" header lines, as in sql-data-integrity.
// The queries are plain SQL that also runs on Postgres (Day 49).

export const CHECKS_DIR = new URL('../sql/checks/', import.meta.url);

// How long an idempotency key may stay in flight before it is reported (BK-R29).
export const STALE_KEY_MS = 10 * 60 * 1000;

export type Severity = 'error' | 'warning';

export interface Check {
  id: string;
  file: string;
  severity: Severity;
  description: string;
  sql: string;
}

export interface CheckResult {
  id: string;
  severity: Severity;
  description: string;
  rows: Record<string, unknown>[];
  // Set when the query could not run (a missing table or column): reported, not skipped.
  error?: string;
}

export interface Summary {
  checks: number;
  passed: number;
  errors: number;
  warnings: number;
  badRows: number;
}

// Reads the header lines at the top of a check. Split on \r?\n: sql-data-integrity
// rejected every check on Windows when a CRLF checkout left \r on each value.
export function parseCheck(text: string, file: string): Check {
  const meta: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^--\s*(id|severity|description):\s*(.+)$/.exec(line);
    if (m) meta[m[1]!] = m[2]!.trim();
    else if (!line.startsWith('--')) break;
  }
  const { id, severity, description } = meta;
  if (!id || !severity || !description) throw new Error(`check ${file} needs id, severity and description headers`);
  if (severity !== 'error' && severity !== 'warning') throw new Error(`check ${file} has unknown severity "${severity}"`);
  return { id, file, severity, description, sql: text };
}

export function loadChecks(dir: URL = CHECKS_DIR): Check[] {
  const checks = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => parseCheck(readFileSync(new URL(f, dir), 'utf8'), f));
  const ids = checks.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate check ids: ${dupes.join(', ')}`);
  return checks;
}

// The named parameters a check may use, worked out from the time the checks run.
export const parameters = (now: Date): Record<string, string> => ({
  stale_before: new Date(now.getTime() - STALE_KEY_MS).toISOString(),
});

// The `:name` parameters in a query, outside comments.
export const parametersOf = (sql: string): string[] =>
  [...new Set([...sql.replace(/--.*$/gm, '').matchAll(/(?<![:\w]):([a-z_]+)/g)].map((m) => m[1]!))];

export function runChecks(db: DatabaseSync, checks: Check[] = loadChecks(), { now = new Date() }: { now?: Date } = {}): CheckResult[] {
  const values = parameters(now);
  return checks.map(({ id, severity, description, sql }): CheckResult => {
    try {
      const statement = db.prepare(sql);
      // BigInt, so a sum past 2^53 is shown exactly.
      statement.setReadBigInts(true);
      const names = parametersOf(sql);
      const missing = names.filter((n) => !(n in values));
      if (missing.length) throw new Error(`unknown parameter ${missing.map((n) => `:${n}`).join(', ')}`);
      const rows = names.length ? statement.all(Object.fromEntries(names.map((n) => [n, values[n]!]))) : statement.all();
      return { id, severity, description, rows: rows as Record<string, unknown>[] };
    } catch (err) {
      return { id, severity: 'error', description, rows: [], error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export const failed = (r: CheckResult): boolean => r.rows.length > 0 || r.error !== undefined;

export function summarize(results: CheckResult[]): Summary {
  const failing = results.filter(failed);
  return {
    checks: results.length,
    passed: results.length - failing.length,
    errors: failing.filter((r) => r.severity === 'error').length,
    warnings: failing.filter((r) => r.severity === 'warning').length,
    badRows: results.reduce((n, r) => n + r.rows.length, 0),
  };
}

const status = (r: CheckResult) => (r.error ? 'ERROR' : r.rows.length === 0 ? 'pass' : r.severity === 'error' ? 'FAIL' : 'warn');

export function formatText(results: CheckResult[], { maxRows = 3 } = {}): string {
  const s = summarize(results);
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${status(r).padEnd(5)} ${r.id.padEnd(22)} ${r.rows.length ? `${r.rows.length} row(s)` : ''}`.trimEnd());
    if (r.error) lines.push(`      could not run: ${r.error}`);
    for (const row of r.rows.slice(0, maxRows)) {
      lines.push(`      ${Object.entries(row).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    if (r.rows.length > maxRows) lines.push(`      ... and ${r.rows.length - maxRows} more`);
  }
  lines.push('', `${s.passed}/${s.checks} checks passed, ${s.errors} error(s), ${s.warnings} warning(s), ${s.badRows} bad row(s)`);
  return lines.join('\n');
}
