#!/usr/bin/env node
// Usage: node src/variance-cli.ts <report.json | folder-of-reports> [--window N]
//
// One report made with `npx playwright test --repeat-each=N --retries=0`, or a
// folder with one report per CI run. Prints Markdown: pass rates with 95%
// confidence intervals, and how many runs it takes to catch a flaky test.
// --window sets the run count used in the last table (default: the most runs
// any test had).
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze, type PlaywrightReport } from './analyze.ts';
import { varianceMarkdown, varianceRows } from './variance.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { window: { type: 'string' } } });
const input = positionals[0];
if (!input) {
  console.error('Usage: node src/variance-cli.ts <report.json | folder-of-reports> [--window N]');
  process.exit(2);
}

const files = (await stat(input)).isDirectory()
  ? (await readdir(input)).filter((f) => f.endsWith('.json')).map((f) => path.join(input, f))
  : [input];
if (files.length === 0) {
  console.error(`No .json reports found in ${input}`);
  process.exit(2);
}
const reports = await Promise.all(files.map(async (f) => JSON.parse(await readFile(f, 'utf8')) as PlaywrightReport));
const report = varianceRows(analyze(reports));
if (report.tests === 0) {
  console.error('The reports contain no test results.');
  process.exit(2);
}
const window = values.window ? Number(values.window) : Math.max(...report.rows.map((r) => r.runs));
if (!Number.isInteger(window) || window < 1) {
  console.error(`--window must be a whole number of runs, got ${values.window}`);
  process.exit(2);
}
console.log(varianceMarkdown(report, window));
