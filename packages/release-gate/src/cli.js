#!/usr/bin/env node
/**
 * Usage:
 *   node src/cli.js --policy gate.policy.json \
 *     --playwright smoke=path/to/playwright.json \
 *     --k6 performance=path/to/k6-summary.json \
 *     --check contract=path/to/result.json \
 *     [--version 1.4.0] \
 *     [--release release.json --memo memo.md]
 *     [--readiness readiness.json --page readiness.html]
 *
 * Prints the decision, appends it to the GitHub Actions job summary when running
 * there, and exits 1 on NO-GO so the deploy job never starts.
 */

import fs from 'fs';
import { pathToFileURL } from 'url';
import { fromPlaywright, fromK6, fromCheck } from './adapters.js';
import { decide, formatMarkdown } from './gate.js';
import { formatMemo } from './memo.js';
import { applyChange, isRealDate } from './change.js';
import { fromReadiness, formatPage } from './readiness.js';

const ADAPTERS = { '--playwright': fromPlaywright, '--k6': fromK6, '--check': fromCheck };

export function parseArgs(argv) {
  const opts = { policy: null, version: null, release: null, memo: null, readiness: null, page: null, today: null, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--policy') { opts.policy = value; i++; }
    else if (flag === '--version') { opts.version = value; i++; }
    else if (flag === '--release' || flag === '--memo' || flag === '--readiness' || flag === '--page' || flag === '--today') {
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
  if (opts.today !== null && !isRealDate(opts.today)) throw new Error('--today needs a date such as 2026-11-22');
  if (Boolean(opts.readiness) !== Boolean(opts.page)) throw new Error('--readiness and --page go together: the page needs the readiness file and a place to write to');
  if (opts.page && !opts.release) throw new Error('--page needs --release too: the page takes the version and date from the release file');
  if (opts.inputs.length === 0 && !opts.readiness) throw new Error('Give at least one result: --playwright, --k6 or --check');
  return opts;
}

export function run(opts) {
  const policy = opts.policy ? JSON.parse(fs.readFileSync(opts.policy, 'utf8')) : {};
  const results = opts.inputs.map(({ adapter, name, file }) => {
    if (!fs.existsSync(file)) return { name, kind: 'check', passed: false, detail: `result file not found: ${file}` };
    return ADAPTERS[adapter](name, JSON.parse(fs.readFileSync(file, 'utf8')));
  });
  // A bad readiness file is a failed check, so the decision is still made and still says why.
  let readinessData = null;
  if (opts.readiness) {
    if (!fs.existsSync(opts.readiness)) results.push({ name: 'readiness', kind: 'check', passed: false, detail: `result file not found: ${opts.readiness}` });
    else {
      try {
        readinessData = JSON.parse(fs.readFileSync(opts.readiness, 'utf8'));
        results.push(...fromReadiness(readinessData, policy));
      } catch (err) {
        readinessData = null;
        results.push({ name: 'readiness', kind: 'check', passed: false, detail: err.message });
      }
    }
  }
  let outcome = decide(policy, results);
  // A bad release file must not hide the decision: the gate table is still printed and the exit code says the memo failed.
  // Without a release file there is no change block; only a policy that requires one blocks.
  if (!opts.release) outcome = applyChange(outcome, policy, undefined);
  let memo = null;
  let page = null;
  let memoError = null;
  if (opts.release) {
    try {
      const release = JSON.parse(fs.readFileSync(opts.release, 'utf8'));
      outcome = applyChange(outcome, policy, release.change);
      memo = formatMemo(outcome, release);
      if (opts.page) {
        if (!readinessData) throw new Error(`readiness page: ${opts.readiness} could not be read, see the readiness check above`);
        page = formatPage(outcome, readinessData, release, { today: opts.today ?? undefined });
      }
    } catch (err) { memoError = err; }
  }
  return { outcome, markdown: formatMarkdown(outcome, { version: opts.version }), memo, page, memoError };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const { outcome, markdown, memo, page, memoError } = run(opts);
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    if (memoError) throw memoError;
    if (memo) fs.writeFileSync(opts.memo, memo);
    if (page) fs.writeFileSync(opts.page, page);
    if (outcome.decision !== 'go') process.exitCode = 1;
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
