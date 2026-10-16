import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const ex = (name) => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('parseArgs validates input and parses levels', () => {
  assert.throws(() => parseArgs([]), /at least one log file/);
  assert.throws(() => parseArgs(['a.log', '--top', '0']), /--top/);
  assert.deepEqual(parseArgs(['a.log', '--levels', 'error, warn']).levels, ['ERROR', 'WARN']);
});

test('CLI lists the top patterns', () => {
  const res = run(ex('app-2026-10-16.log'), '--top', '2');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^13 entries, 11 at FATAL\/ERROR\/WARN, 5 pattern\(s\)/);
  assert.match(res.stdout, / {4}5 {2}ERROR Timeout calling bank API after <num>ms for order <uuid> {2}\[payments\]/);
  assert.doesNotMatch(res.stdout, /User not found/); // only the top 2
});

test('CLI exits 1 when a new error pattern appears since the baseline', () => {
  const res = run(ex('app-2026-10-16.log'), '--baseline', ex('app-2026-10-15.log'));
  assert.equal(res.status, 1);
  assert.match(res.stdout, /New since baseline: 1/);
  assert.match(res.stdout, /At least doubled since baseline: 1/);
  assert.match(res.stdout, /5 \(was 2\)/);
  assert.match(res.stdout, /Gone since baseline: 1/);
});

test('CLI exits 0 when comparing a log with itself', () => {
  const res = run(ex('app-2026-10-16.log'), '--baseline', ex('app-2026-10-16.log'));
  assert.equal(res.status, 0);
  assert.match(res.stdout, /New since baseline: 0/);
});

test('CLI prints a Markdown table', () => {
  assert.match(run(ex('app-2026-10-16.log'), '--format', 'md').stdout, /\| 3 \| ERROR \| `TypeError: Cannot read properties of undefined \(reading <str>\)` \| checkout \|/);
});
