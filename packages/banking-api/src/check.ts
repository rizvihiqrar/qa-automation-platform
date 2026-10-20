// Runs the SQL ledger checks (sql/checks) against a ledger database.
//   node src/check.ts --db path/to/ledger.db   # a real file, opened read-only
//   node src/check.ts --demo                   # the sample ledger with defects put in by hand
// Exit code 1 when any error-level check finds a row, so it can fail a pipeline;
// warnings are shown but don't fail. 2 when the arguments or the file are wrong.

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { formatText, runChecks, summarize } from './checks.ts';
import { BUSY_TIMEOUT_MS } from './ledger.ts';
import { SAMPLE_NOW, buildSample } from './sample.ts';

export type CliArgs = { db: string } | { demo: true };

export function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 1 && argv[0] === '--demo') return { demo: true };
  if (argv.length === 2 && argv[0] === '--db' && argv[1] && !argv[1].startsWith('--')) return { db: argv[1] };
  throw new Error('usage: node src/check.ts --db <file> | --demo');
}

// Puts SQL into a ledger past the API and its constraints, as another tool would:
// foreign keys are off unless a connection turns them on.
export function inject(db: DatabaseSync, sql: string): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(sql);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  let db: DatabaseSync;
  let now = new Date();
  if ('demo' in args) {
    db = buildSample().db;
    inject(db, readFileSync(new URL('../sql/demo-defects.sql', import.meta.url), 'utf8'));
    now = SAMPLE_NOW;
  } else {
    // Read-only, and waiting for a server's write rather than failing (BK-R25).
    db = new DatabaseSync(args.db, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
  }
  try {
    const results = runChecks(db, undefined, { now });
    console.log(formatText(results));
    if (summarize(results).errors > 0) process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  }
}
