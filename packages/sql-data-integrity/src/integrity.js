// Loads the SQL checks, builds databases, and runs the checks.
// Each check is a .sql file whose query returns the rows that break one rule.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHECKS_DIR = path.join(ROOT, 'checks');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

let sqlPromise;
const sqlJs = () => (sqlPromise ??= initSqlJs());

// Reads "-- key: value" header lines at the top of a check file.
export function parseCheck(text, file = '') {
  const meta = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^--\s*(id|severity|description):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
    else if (!line.startsWith('--')) break;
  }
  if (!meta.id || !meta.severity || !meta.description) throw new Error(`Check ${file} needs id, severity and description headers`);
  if (!['error', 'warning'].includes(meta.severity)) throw new Error(`Check ${file} has unknown severity "${meta.severity}"`);
  return { ...meta, sql: text };
}

export function loadChecks(dir = CHECKS_DIR) {
  const checks = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => parseCheck(fs.readFileSync(path.join(dir, f), 'utf8'), f));
  const ids = checks.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate check ids: ${dupes.join(', ')}`);
  return checks;
}

// A fresh in-memory database: schema + clean seed, then any extra SQL (defects).
export async function createDatabase({ extraSql = [] } = {}) {
  const SQL = await sqlJs();
  const db = new SQL.Database();
  db.run(read('schema', 'schema.sql'));
  db.run(read('schema', 'seed-clean.sql'));
  for (const sql of extraSql) db.run(sql);
  return db;
}

// The demo dataset: clean data plus a realistic batch of defects.
export async function createDemoDatabase() {
  return createDatabase({ extraSql: [read('datasets', 'demo-defects.sql')] });
}

// Opens an existing SQLite file (read into memory; the file is never written).
export async function openDatabaseFile(file) {
  const SQL = await sqlJs();
  return new SQL.Database(fs.readFileSync(file));
}

export function runChecks(db, checks = loadChecks()) {
  return checks.map(({ id, severity, description, sql }) => {
    try {
      const [result] = db.exec(sql);
      return { id, severity, description, columns: result?.columns ?? [], rows: result?.values ?? [] };
    } catch (err) {
      // A check that can't run (missing table or column) is reported, not skipped.
      return { id, severity: 'error', description, columns: [], rows: [], error: err.message };
    }
  });
}

export function summarizeResults(results) {
  const failing = results.filter((r) => r.rows.length > 0 || r.error);
  return {
    checks: results.length,
    passed: results.length - failing.length,
    errors: failing.filter((r) => r.severity === 'error').length,
    warnings: failing.filter((r) => r.severity === 'warning').length,
    badRows: results.reduce((n, r) => n + r.rows.length, 0),
  };
}
