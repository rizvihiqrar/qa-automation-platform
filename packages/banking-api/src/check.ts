// Runs the SQL ledger checks (sql/checks) against a ledger database.
//   node src/check.ts --db path/to/ledger.db        # a real SQLite file, opened read-only
//   node src/check.ts --db postgres://user@host/db  # a Postgres ledger, read in a read-only session
//                                                   # (DATABASE_SCHEMA names its schema; default public)
//   node src/check.ts --demo                        # the sample ledger with defects put in by hand
// Exit code 1 when any error-level check finds a row, so it can fail a pipeline;
// warnings are shown but don't fail. 2 when the arguments or the database are wrong.

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { formatText, runChecks, runChecksPostgres, summarize, type CheckResult } from './checks.ts';
import { BUSY_TIMEOUT_MS } from './ledger.ts';
import { SAMPLE_NOW, buildSample } from './sample.ts';

export type CliArgs = { db: string } | { demo: true };

export function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 1 && argv[0] === '--demo') return { demo: true };
  if (argv.length === 2 && argv[0] === '--db' && argv[1] && !argv[1].startsWith('--')) return { db: argv[1] };
  throw new Error('usage: node src/check.ts --db <file or postgres:// URL> | --demo');
}

export const isPostgresUrl = (db: string): boolean => /^postgres(ql)?:\/\//i.test(db);

// Puts SQL into a ledger past the API and its constraints, as another tool would:
// foreign keys are off unless a connection turns them on.
export function inject(db: DatabaseSync, sql: string): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(sql);
}

// The checks on a Postgres ledger. The session is read-only, as the SQLite file is opened
// read-only: a wrong schema reports missing tables instead of making empty ones. pg is
// loaded only here, so checking a SQLite file needs nothing from npm.
async function checkPostgres(url: string, schema: string, now: Date): Promise<CheckResult[]> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`DATABASE_SCHEMA must be a lower-case SQL name, not ${JSON.stringify(schema)}`);
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, options: `-c search_path=${schema} -c default_transaction_read_only=on` });
  // int8 and numeric as BigInt, so a total past 2^53 is shown exactly.
  for (const oid of [20, 1700]) client.setTypeParser(oid, (value: string) => BigInt(value));
  // A connection lost while the checks run fails the query in hand, which the runner reports;
  // without a listener the same event would end the process with no exit code of its own.
  client.on('error', (err) => console.error(`postgres: ${err.message}`));
  await client.connect();
  try {
    return await runChecksPostgres(async (text, params) => (await client.query(text, params)).rows, undefined, { now });
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let results: CheckResult[];
  if ('db' in args && isPostgresUrl(args.db)) {
    results = await checkPostgres(args.db, process.env.DATABASE_SCHEMA || 'public', new Date());
  } else {
    let db: DatabaseSync;
    let now = new Date();
    if ('demo' in args) {
      db = (await buildSample()).db;
      inject(db, readFileSync(new URL('../sql/demo-defects.sql', import.meta.url), 'utf8'));
      now = SAMPLE_NOW;
    } else {
      // Read-only, and waiting for a server's write rather than failing (BK-R25).
      db = new DatabaseSync(args.db, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
    }
    try {
      results = runChecks(db, undefined, { now });
    } finally {
      db.close();
    }
  }
  console.log(formatText(results));
  if (summarize(results).errors > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  }
}
