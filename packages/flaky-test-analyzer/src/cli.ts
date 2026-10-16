#!/usr/bin/env node
// Usage: node src/cli.ts <folder-of-playwright-json-reports>
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { analyze, type PlaywrightReport } from './analyze.ts';
import { toMarkdown } from './report.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node src/cli.ts <folder-of-playwright-json-reports>');
  process.exit(2);
}

const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`No .json reports found in ${dir}`);
  process.exit(2);
}

const reports: PlaywrightReport[] = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8')) as PlaywrightReport)
);
const rows = analyze(reports);
console.log(`Analyzed ${reports.length} run(s), ${rows.length} test(s)\n`);
console.log(toMarkdown(rows));
