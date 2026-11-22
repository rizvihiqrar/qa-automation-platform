#!/usr/bin/env node
/**
 * Usage:
 *   node src/cli.js --policy gate.policy.json \
 *     --playwright smoke=path/to/playwright.json \
 *     --k6 performance=path/to/k6-summary.json \
 *     --check contract=path/to/result.json \
 *     [--version 1.4.0] \
 *     [--release release.json --memo memo.md]
 *
 * Prints the decision, appends it to the GitHub Actions job summary when running
 * there, and exits 1 on NO-GO so the deploy job never starts.
 */

import fs from 'fs';
import { pathToFileURL } from 'url';
import { fromPlaywright, fromK6, fromCheck } from './adapters.js';
import { decide, formatMarkdown } from './gate.js';
import { formatMemo } from './memo.js';

const ADAPTERS = { '--playwright': fromPlaywright, '--k6': fromK6, '--check': fromCheck };

export function parseArgs(argv) {
  const opts = { policy: null, version: null, release: null, memo: null, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--policy') { opts.policy = value; i++; }
    else if (flag === '--version') { opts.version = value; i++; }
    else if (flag === '--release' || flag === '--memo') {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a file path`);
      opts[flag.slice(2)] = value;
      i++;
    }
    else if (ADAPTERS[flag]) {
      const m = /^([\w-]+)=(.+)$/.exec(value ?? '');
      if (!m) throw new Error(`${flag} needs name=path, got "${value}"`);
      opts.inputs.push({ adapter: flag, name: m[1], file: m[2] });
      i++;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (Boolean(opts.release) !== Boolean(opts.memo)) throw new Error('--release and --memo go together: the memo needs the release file and a place to write to');
  if (opts.inputs.length === 0) throw new Error('Give at least one result: --playwright, --k6 or --check');
  return opts;
}

export function run(opts) {
  const policy = opts.policy ? JSON.parse(fs.readFileSync(opts.policy, 'utf8')) : {};
  const results = opts.inputs.map(({ adapter, name, file }) => {
    if (!fs.existsSync(file)) return { name, kind: 'check', passed: false, detail: `result file not found: ${file}` };
    return ADAPTERS[adapter](name, JSON.parse(fs.readFileSync(file, 'utf8')));
  });
  const outcome = decide(policy, results);
  // A bad release file must not hide the decision: the gate table is still printed and the exit code says the memo failed.
  let memo = null;
  let memoError = null;
  if (opts.release) {
    try { memo = formatMemo(outcome, JSON.parse(fs.readFileSync(opts.release, 'utf8'))); } catch (err) { memoError = err; }
  }
  return { outcome, markdown: formatMarkdown(outcome, { version: opts.version }), memo, memoError };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const { outcome, markdown, memo, memoError } = run(opts);
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    if (memoError) throw memoError;
    if (memo) fs.writeFileSync(opts.memo, memo);
    if (outcome.decision !== 'go') process.exitCode = 1;
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
