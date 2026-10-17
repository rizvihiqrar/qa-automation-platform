// Loads the SQL checks, builds databases, and runs the checks.
// Each check is a .sql file whose query returns the rows that break one rule.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHECKS_DIR = path.join(ROOT, 'checks');
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

export type Severity = 'error' | 'warning';

export interface Check {
  id: string;
  severity: Severity;
  description: string;
  sql: string;
}

export interface CheckResult {
  id: string;
  severity: Severity;
  description: string;
  columns: string[];
  rows: SqlValue[][];
  // Set when the check's query could not run.
  error?: string;
}

export interface Summary {
  checks: number;
  passed: number;
  errors: number;
  warnings: number;
  badRows: number;
}

let sqlPromise: Promise<SqlJsStatic> | undefined;
const sqlJs = () => (sqlPromise ??= initSqlJs());

const isSeverity = (value: string | undefined): value is Severity => value === 'error' || value === 'warning';

// Reads "-- key: value" header lines at the top of a check file.
// Splits on \r?\n: with Windows (CRLF) line endings, `.` in the header regex
// doesn't match the trailing \r, so every check used to be rejected on Windows.
export function parseCheck(text: string, file = ''): Check {
  const meta: Partial<Record<'id' | 'severity' | 'description', string>> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^--\s*(id|severity|description):\s*(.+)$/);
    if (m) meta[m[1] as keyof typeof meta] = m[2]?.trim();
    else if (!line.startsWith('--')) break;
  }
  const { id, severity, description } = meta;
  if (!id || !severity || !description) throw new Error(`Check ${file} needs id, severity and description headers`);
  if (!isSeverity(severity)) throw new Error(`Check ${file} has unknown severity "${severity}"`);
  return { id, severity, description, sql: text };
}

export function loadChecks(dir = CHECKS_DIR): Check[] {
  const checks = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => parseCheck(fs.readFileSync(path.join(dir, f), 'utf8'), f));
  const ids = checks.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate check ids: ${dupes.join(', ')}`);
  return checks;
}

// A fresh in-memory database: schema + clean seed, then any extra SQL (defects).
export async function createDatabase({ extraSql = [] }: { extraSql?: string[] } = {}): Promise<Database> {
  const SQL = await sqlJs();
  const db = new SQL.Database();
  db.run(read('schema', 'schema.sql'));
  db.run(read('schema', 'seed-clean.sql'));
  for (const sql of extraSql) db.run(sql);
  return db;
}

// The demo dataset: clean data plus a realistic batch of defects.
export async function createDemoDatabase(): Promise<Database> {
  return createDatabase({ extraSql: [read('datasets', 'demo-defects.sql')] });
}

// Opens an existing SQLite file (read into memory; the file is never written).
export async function openDatabaseFile(file: string): Promise<Database> {
  const SQL = await sqlJs();
  return new SQL.Database(fs.readFileSync(file));
}

export function runChecks(db: Database, checks: Check[] = loadChecks()): CheckResult[] {
  return checks.map(({ id, severity, description, sql }): CheckResult => {
    try {
      const [result] = db.exec(sql);
      return { id, severity, description, columns: result?.columns ?? [], rows: result?.values ?? [] };
    } catch (err) {
      // A check that can't run (missing table or column) is reported, not skipped.
      return { id, severity: 'error', description, columns: [], rows: [], error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function summarizeResults(results: CheckResult[]): Summary {
  const failing = results.filter((r) => r.rows.length > 0 || r.error);
  return {
    checks: results.length,
    passed: results.length - failing.length,
    errors: failing.filter((r) => r.severity === 'error').length,
    warnings: failing.filter((r) => r.severity === 'warning').length,
    badRows: results.reduce((n, r) => n + r.rows.length, 0),
  };
}
