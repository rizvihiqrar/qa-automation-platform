#!/usr/bin/env node
/**
 * Usage:
 *   node src/cli.js                       # clean dataset (all checks should pass)
 *   node src/cli.js --dataset demo        # clean data plus realistic defects
 *   node src/cli.js --db path/to/file.db  # your own SQLite file (opened read-only, in memory)
 *   add --format md for a Markdown table
 *
 * Exit code 1 when any error-level check finds bad rows, so it can gate a pipeline.
 * Warnings are reported but don't fail.
 */

import { pathToFileURL } from 'url';
import { createDatabase, createDemoDatabase, openDatabaseFile, runChecks, summarizeResults } from './integrity.js';
import { formatText, formatMarkdown } from './report.js';

export function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
  const dataset = get('--dataset') ?? 'clean';
  const db = get('--db');
  const format = get('--format') ?? 'text';
  if (!['clean', 'demo'].includes(dataset)) throw new Error(`Unknown dataset "${dataset}". Use clean or demo.`);
  if (!['text', 'md'].includes(format)) throw new Error(`Unknown format "${format}". Use text or md.`);
  if (db && argv.includes('--dataset')) throw new Error('Use --dataset or --db, not both.');
  return { dataset, db, format };
}

async function main() {
  const { dataset, db: dbFile, format } = parseArgs(process.argv.slice(2));
  const db = dbFile ? await openDatabaseFile(dbFile) : dataset === 'demo' ? await createDemoDatabase() : await createDatabase();
  const results = runChecks(db);
  console.log(format === 'md' ? formatMarkdown(results) : formatText(results));
  if (summarizeResults(results).errors > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(2); });
}
