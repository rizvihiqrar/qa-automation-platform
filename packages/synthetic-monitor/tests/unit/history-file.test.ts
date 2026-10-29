import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readHistory, writeFileAtomic } from '../../src/history-file.ts';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-'));

test('no file yet is a first run: an empty history', () => {
  assert.deepEqual(readHistory(path.join(dir(), 'history.json')), { runs: [] });
});

test('a history written is the history read', () => {
  const file = path.join(dir(), 'nested', 'history.json');
  const history = { runs: [{ t: '2026-10-29T12:00:00Z', results: { a: { ok: true, ms: 5, attempts: 1 } } }] };
  writeFileAtomic(file, JSON.stringify(history));
  assert.deepEqual(readHistory(file), history);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('a truncated file is an error, not an empty history', () => {
  const file = path.join(dir(), 'history.json');
  fs.writeFileSync(file, '{"runs":[{"t":"2026-10-2');
  assert.throws(() => readHistory(file), SyntaxError);
});

test('a file without a runs list is an error', () => {
  const file = path.join(dir(), 'history.json');
  fs.writeFileSync(file, '{"something":"else"}');
  assert.throws(() => readHistory(file), /no "runs" list/);
});
