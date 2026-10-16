#!/usr/bin/env node
/**
 * Usage:
 *   node src/cli.js app.log                          # top error and warning patterns
 *   node src/cli.js app.log --levels ERROR --top 5
 *   node src/cli.js today.log --baseline yesterday.log
 *   add --format md for a Markdown table
 *
 * With --baseline, exit code 1 if a new ERROR or FATAL pattern appears.
 */

import fs from 'fs';
import { pathToFileURL } from 'url';
import { parseLog, groupEntries, compareGroups } from './logs.js';

export function parseArgs(argv) {
  const opts = { files: [], levels: ['FATAL', 'ERROR', 'WARN'], top: 10, baseline: null, format: 'text' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--levels') opts.levels = argv[++i].split(',').map((l) => l.trim().toUpperCase());
    else if (a === '--top') opts.top = Number(argv[++i]);
    else if (a === '--baseline') opts.baseline = argv[++i];
    else if (a === '--format') opts.format = argv[++i];
    else opts.files.push(a);
  }
  if (opts.files.length === 0) throw new Error('Give at least one log file');
  if (!Number.isInteger(opts.top) || opts.top < 1) throw new Error('--top must be a positive whole number');
  if (!['text', 'md'].includes(opts.format)) throw new Error(`Unknown format "${opts.format}". Use text or md.`);
  return opts;
}

const load = (files) => files.flatMap((f) => parseLog(fs.readFileSync(f, 'utf8')));

function table(groups, format, extra = () => '') {
  if (format === 'md') {
    return ['| Count | Level | Pattern | Services |', '|---:|---|---|---|',
      ...groups.map((g) => `| ${g.count}${extra(g)} | ${g.level} | \`${g.signature}\` | ${g.services.join(', ')} |`)].join('\n');
  }
  return groups.map((g) => `${String(g.count).padStart(5)}${extra(g)}  ${g.level.padEnd(5)} ${g.signature}${g.services.length ? `  [${g.services.join(', ')}]` : ''}`).join('\n');
}

export function run(opts) {
  const entries = load(opts.files);
  const groups = groupEntries(entries, { levels: opts.levels });
  const out = [];
  const matched = groups.reduce((n, g) => n + g.count, 0);
  out.push(`${entries.length} entries, ${matched} at ${opts.levels.join('/')}, ${groups.length} pattern(s)`, '');
  out.push(table(groups.slice(0, opts.top), opts.format));

  let regression = false;
  if (opts.baseline) {
    const diff = compareGroups(groupEntries(load([opts.baseline]), { levels: opts.levels }), groups);
    out.push('', `New since baseline: ${diff.new.length}`);
    if (diff.new.length) out.push(table(diff.new, opts.format));
    out.push('', `At least doubled since baseline: ${diff.grew.length}`);
    if (diff.grew.length) out.push(table(diff.grew, opts.format, (g) => ` (was ${g.before})`));
    out.push('', `Gone since baseline: ${diff.gone.length}`);
    regression = diff.new.some((g) => g.level === 'ERROR' || g.level === 'FATAL');
  }
  return { text: out.join('\n'), regression };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { text, regression } = run(parseArgs(process.argv.slice(2)));
    console.log(text);
    if (regression) process.exitCode = 1;
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
