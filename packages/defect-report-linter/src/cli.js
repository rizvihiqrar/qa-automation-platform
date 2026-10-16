#!/usr/bin/env node
/**
 * Usage:
 *   node src/cli.js examples/                 # every .md and .json file in a folder
 *   node src/cli.js report.md other.json      # specific files
 *   add --format md for a Markdown summary, --min-score 80 to fail low scores
 *
 * Exit code 1 if any report has an error (or scores below --min-score).
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseFile } from './parse.js';
import { lintReport } from './rules.js';

export function parseArgs(argv) {
  const opts = { paths: [], format: 'text', minScore: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--format') opts.format = argv[++i];
    else if (argv[i] === '--min-score') opts.minScore = Number(argv[++i]);
    else opts.paths.push(argv[i]);
  }
  if (opts.paths.length === 0) throw new Error('Give at least one report file or folder');
  if (!['text', 'md'].includes(opts.format)) throw new Error(`Unknown format "${opts.format}". Use text or md.`);
  if (!Number.isFinite(opts.minScore) || opts.minScore < 0 || opts.minScore > 100) throw new Error('--min-score must be 0 to 100');
  return opts;
}

export function collectFiles(paths) {
  return paths.flatMap((p) => (fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((f) => /\.(md|json)$/i.test(f)).sort().map((f) => path.join(p, f))
    : [p]));
}

export function lintFiles(files) {
  return files.flatMap((file) => parseFile(fs.readFileSync(file, 'utf8'), path.basename(file)).map((r) => lintReport(r)));
}

export function formatText(results) {
  const lines = [];
  for (const r of results) {
    lines.push(`${String(r.score).padStart(3)}  ${r.status.padEnd(12)} ${r.source}  ${r.title || '(no title)'}`);
    for (const f of r.findings) lines.push(`       ${f.severity.padEnd(7)} ${f.rule}: ${f.message}`);
  }
  const ready = results.filter((r) => r.status === 'Ready').length;
  lines.push('', `${results.length} report(s): ${ready} ready, ${results.filter((r) => r.status === 'Needs polish').length} need polish, ${results.filter((r) => r.status === 'Not ready').length} not ready`);
  return lines.join('\n');
}

export function formatMarkdown(results) {
  return [
    '| Score | Status | Report | Problems |',
    '|---:|---|---|---|',
    ...results.map((r) => `| ${r.score} | ${r.status} | ${r.source}: ${r.title || '(no title)'} | ${r.findings.map((f) => f.rule).join(', ') || '—'} |`),
  ].join('\n') + '\n';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = lintFiles(collectFiles(opts.paths));
  console.log(opts.format === 'md' ? formatMarkdown(results) : formatText(results));
  if (results.some((r) => r.errors > 0 || r.score < opts.minScore)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (err) { console.error(err.message); process.exit(2); }
}
