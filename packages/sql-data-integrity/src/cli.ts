#!/usr/bin/env node
/**
 * Usage:
 *   node src/cli.ts                       # clean dataset (all checks should pass)
 *   node src/cli.ts --dataset demo        # clean data plus realistic defects
 *   node src/cli.ts --db path/to/file.db  # your own SQLite file (opened read-only, in memory)
 *   add --format md for a Markdown table
 *
 * Exit code 1 when any error-level check finds bad rows, so it can gate a pipeline.
 * Warnings are reported but don't fail.
 */

import { pathToFileURL } from 'node:url';
import { createDatabase, createDemoDatabase, openDatabaseFile, runChecks, summarizeResults } from './integrity.ts';
import { formatText, formatMarkdown } from './report.ts';

export interface CliArgs {
  dataset: 'clean' | 'demo';
  db: string | null;
  format: 'text' | 'md';
}

export function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const value = argv[i + 1];
    // A flag at the end with no value used to fall back to the default silently.
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  const dataset = get('--dataset') ?? 'clean';
  const db = get('--db');
  const format = get('--format') ?? 'text';
  if (dataset !== 'clean' && dataset !== 'demo') throw new Error(`Unknown dataset "${dataset}". Use clean or demo.`);
  if (format !== 'text' && format !== 'md') throw new Error(`Unknown format "${format}". Use text or md.`);
  if (db && argv.includes('--dataset')) throw new Error('Use --dataset or --db, not both.');
  return { dataset, db, format };
}

async function main(): Promise<void> {
  const { dataset, db: dbFile, format } = parseArgs(process.argv.slice(2));
  const db = dbFile ? await openDatabaseFile(dbFile) : dataset === 'demo' ? await createDemoDatabase() : await createDatabase();
  const results = runChecks(db);
  console.log(format === 'md' ? formatMarkdown(results) : formatText(results));
  if (summarizeResults(results).errors > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(2); });
}
