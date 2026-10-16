#!/usr/bin/env node
/**
 * Usage:
 *   node src/cli.js --policy gate.policy.json \
 *     --playwright smoke=path/to/playwright.json \
 *     --k6 performance=path/to/k6-summary.json \
 *     --check contract=path/to/result.json \
 *     [--version 1.4.0]
 *
 * Prints the decision, appends it to the GitHub Actions job summary when running
 * there, and exits 1 on NO-GO so the deploy job never starts.
 */

import fs from 'fs';
import { pathToFileURL } from 'url';
import { fromPlaywright, fromK6, fromCheck } from './adapters.js';
import { decide, formatMarkdown } from './gate.js';

const ADAPTERS = { '--playwright': fromPlaywright, '--k6': fromK6, '--check': fromCheck };

export function parseArgs(argv) {
  const opts = { policy: null, version: null, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--policy') { opts.policy = value; i++; }
    else if (flag === '--version') { opts.version = value; i++; }
    else if (ADAPTERS[flag]) {
      const m = /^([\w-]+)=(.+)$/.exec(value ?? '');
      if (!m) throw new Error(`${flag} needs name=path, got "${value}"`);
      opts.inputs.push({ adapter: flag, name: m[1], file: m[2] });
      i++;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
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
  return { outcome, markdown: formatMarkdown(outcome, { version: opts.version }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { outcome, markdown } = run(parseArgs(process.argv.slice(2)));
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    if (outcome.decision !== 'go') process.exitCode = 1;
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
