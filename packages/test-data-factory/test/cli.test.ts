import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/index.ts';

const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('parseArgs applies defaults', () => {
  assert.deepEqual(parseArgs([]), { type: 'users', format: 'json', count: 10, seed: null, output: null, table: 'users' });
});

test('parseArgs rejects unknown types and formats', () => {
  assert.throws(() => parseArgs(['--type', 'cars']), /Unknown type "cars"/);
  assert.throws(() => parseArgs(['--format', 'xml']), /Unknown format "xml"/);
});

test('parseArgs rejects a count that is not a positive whole number', () => {
  for (const bad of ['abc', '0', '-3', '2.5']) {
    assert.throws(() => parseArgs(['--count', bad]), /--count must be a positive whole number/, bad);
  }
});

test('CLI prints the requested number of JSON records', () => {
  const res = run('--type', 'products', '--count', '4');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).length, 4);
});

test('CLI with the same seed prints identical output', () => {
  const a = run('--type', 'orders', '--count', '3', '--seed', '7', '--format', 'csv');
  const b = run('--type', 'orders', '--count', '3', '--seed', '7', '--format', 'csv');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stdout.trim().split('\n').length, 4); // header + 3 rows
});

test('CLI exits with an error for bad input instead of writing empty output', () => {
  const res = run('--count', 'abc');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--count must be a positive whole number/);
  assert.equal(res.stdout, '');
});

test('CLI writes SQL with the requested table name', () => {
  const res = run('--type', 'users', '--count', '2', '--format', 'sql', '--table', 'test_users', '--seed', '1');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^INSERT INTO `test_users`/);
});
