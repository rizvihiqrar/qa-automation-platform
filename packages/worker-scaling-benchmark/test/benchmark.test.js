import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, summarize, toMarkdown } from '../src/summarize.js';
import { parseArgs, parseCounts } from '../src/parse.js';

test('median handles odd and even counts without mutating input', () => {
  const input = [5, 1, 3];
  assert.equal(median(input), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.deepEqual(input, [5, 1, 3]);
});

test('summarize uses the lowest worker count as the baseline', () => {
  const rows = summarize([
    { workers: 2, seconds: 50, passed: 16, failed: 0 },
    { workers: 1, seconds: 100, passed: 16, failed: 0 },
  ]);
  assert.equal(rows[0].workers, 1);
  assert.equal(rows[0].speedup, 1);
  assert.equal(rows[1].speedup, 2);
  assert.equal(rows[1].efficiency, 1);
});

test('efficiency falls when extra workers do not help', () => {
  const rows = summarize([
    { workers: 1, seconds: 100, passed: 16, failed: 0 },
    { workers: 4, seconds: 80, passed: 16, failed: 0 },
  ]);
  assert.equal(rows[1].speedup, 1.25);
  assert.equal(rows[1].efficiency, 1.25 / 4);
});

test('summarize takes the median across repeated runs', () => {
  const rows = summarize([
    { workers: 1, seconds: 90, passed: 16, failed: 0 },
    { workers: 1, seconds: 110, passed: 16, failed: 0 },
    { workers: 1, seconds: 100, passed: 16, failed: 0 },
  ]);
  assert.equal(rows[0].medianSeconds, 100);
  assert.equal(rows[0].runs, 3);
});

test('toMarkdown renders one row per worker count', () => {
  const md = toMarkdown(summarize([{ workers: 1, seconds: 60, passed: 3, failed: 1 }]));
  assert.equal(md.split('\n').length, 3);
  assert.match(md, /\| 1 \| 60\.0 \| 1\.00x \| 100% \| 3 \| 0 \| 1 \|/);
});

test('parseCounts reports flaky tests separately from clean passes', () => {
  const output = '  10 passed\n  4 flaky\n  2 failed';
  assert.deepEqual(parseCounts(output), { passed: 10, flaky: 4, failed: 2 });
});

test('parseCounts reads the last pass and fail totals and ignores ANSI colour codes', () => {
  const output = '\x1b[32m  12 passed\x1b[39m (30s)\n  \x1b[31m4 failed\x1b[39m';
  assert.deepEqual(parseCounts(output), { passed: 12, failed: 4, flaky: 0 });
});

test('parseCounts returns zeros when the output has no summary', () => {
  assert.deepEqual(parseCounts('Error: browser not found'), { passed: 0, failed: 0, flaky: 0 });
});

test('parseArgs applies defaults and parses worker lists', () => {
  const args = parseArgs(['--dir', 'suite', '--workers', '1,2,8', '--runs', '3']);
  assert.deepEqual(args, { dir: 'suite', workers: [1, 2, 8], runs: 3 });
  assert.deepEqual(parseArgs(['--dir', 'suite']).workers, [1, 2, 4]);
});

test('parseArgs rejects a missing directory and bad worker counts', () => {
  assert.throws(() => parseArgs([]), /Missing --dir/);
  assert.throws(() => parseArgs(['--dir', 'x', '--workers', '0']), /positive integers/);
  assert.throws(() => parseArgs(['--dir', 'x', '--bogus']), /Unknown argument/);
});
