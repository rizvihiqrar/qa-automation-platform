#!/usr/bin/env node
/**
 * Usage:
 *   node src/drift-cli.js --history drift/history.json \
 *     --playwright smoke.json [--k6 performance.json] \
 *     [--label 1.4.1] [--json drift-result.json] [--record]
 *
 * Compares the run with the history of past releases and prints any metric that moved
 * more than normal noise. Exit 1 on drift, 2 on bad arguments. --json writes
 * { passed, summary } so the release gate can take it as `--check drift=drift-result.json`.
 * --record adds a clean run to the history (a history shorter than the minimum is
 * filled without checking, so a new history can be started).
 */

import fs from 'fs';
import { pathToFileURL } from 'url';
import { DEFAULTS, METRICS, checkDrift, formatDrift, metricsFromK6, metricsFromPlaywright } from './drift.js';

export function parseArgs(argv) {
  const opts = { history: null, playwright: null, k6: null, label: null, json: null, record: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--record') { opts.record = true; continue; }
    const value = argv[i + 1];
    if (!['--history', '--playwright', '--k6', '--label', '--json'].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    opts[flag.slice(2)] = value;
    i++;
  }
  if (!opts.history) throw new Error('--history is required');
  if (!opts.playwright && !opts.k6) throw new Error('Give at least one result: --playwright or --k6');
  if (opts.record && !opts.label) throw new Error('--record needs a --label for the run');
  return opts;
}

export function readHistory(file) {
  if (!fs.existsSync(file)) return { runs: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.runs)) throw new Error(`${file} needs a "runs" list`);
  return data;
}

export function run(opts) {
  const history = readHistory(opts.history);
  const metrics = {
    ...(opts.playwright ? metricsFromPlaywright(JSON.parse(fs.readFileSync(opts.playwright, 'utf8'))) : {}),
    ...(opts.k6 ? metricsFromK6(JSON.parse(fs.readFileSync(opts.k6, 'utf8'))) : {}),
  };
  // Starting means no run of this kind has enough history yet: a short history, or a history that never recorded these metrics.
  const known = Object.keys(metrics).filter((n) => METRICS[n]);
  const enough = (n) => history.runs.filter((r) => typeof r.metrics[n] === 'number').length >= DEFAULTS.minSamples;
  const starting = !known.some(enough);
  // A run with failures cannot start a history: it would become what normal means.
  if (starting && opts.record && (metrics.failed > 0 || metrics.flaky > 0 || metrics.errorRate > 0)) {
    throw new Error('A run with failed or flaky tests cannot start a history; record clean runs only');
  }
  const alerts = starting ? [] : checkDrift(history.runs, metrics);
  const markdown = starting
    ? `## Release drift: history has ${history.runs.length} of ${DEFAULTS.minSamples} runs needed, nothing to compare with yet\n`
    : formatDrift(alerts, { label: opts.label });
  let recorded = false;
  if (opts.record && alerts.length === 0) {
    history.runs.push({ label: opts.label, metrics });
    fs.writeFileSync(opts.history, JSON.stringify(history, null, 2) + '\n');
    recorded = true;
  }
  const result = {
    passed: alerts.length === 0,
    summary: alerts.length ? `drift in ${alerts.map((a) => a.label).join(', ')}` : starting ? 'no history to compare with yet' : 'no drift beyond normal noise',
  };
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(result, null, 2) + '\n');
  return { alerts, markdown, result, recorded };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { alerts, markdown } = run(parseArgs(process.argv.slice(2)));
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    if (alerts.length) process.exitCode = 1;
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
