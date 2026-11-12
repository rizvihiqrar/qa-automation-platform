import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../src/build.ts';
import { checkFixes, fixesMarkdown, readFixes, type Fix } from '../src/fixes.ts';

const fix = (over: Partial<Fix> = {}): Fix => ({
  id: 'fix-1', date: '2026-11-11', symptom: 'It broke', cause: 'A cause', fix: 'A fix', pr: 1, prMinutes: 90,
  check: 'scripts/x.test.mjs', checkDoes: 'Fails if it returns', ...over,
});
const yes = () => true;

test('every logged fix is complete and names a check that exists in the repo', () => {
  assert.deepEqual(checkFixes(readFixes()), []);
});

test('an entry missing its cause, its check text or its check file is reported', () => {
  assert.deepEqual(checkFixes([fix({ cause: ' ' })], yes), ['fix-1: cause is empty']);
  assert.deepEqual(checkFixes([fix({ checkDoes: '' })], yes), ['fix-1: checkDoes is empty']);
  assert.deepEqual(checkFixes([fix()], () => false), ['fix-1: the check scripts/x.test.mjs does not exist']);
});

test('a bad date, a repeated pull request or the wrong order is reported', () => {
  assert.deepEqual(checkFixes([fix({ date: '11/11' })], yes), ['fix-1: date must look like 2026-11-11']);
  assert.deepEqual(checkFixes([fix(), fix({ id: 'fix-2' })], yes), ['fix-2: pull request #1 is listed twice']);
  assert.deepEqual(checkFixes([fix({ date: '2026-11-01' }), fix({ id: 'fix-2', pr: 2 })], yes), ['fix-2: newest first, but it is dated after fix-1']);
});

test('the page links each pull request and shows the fix time in minutes or hours', () => {
  const md = fixesMarkdown([fix(), fix({ id: 'fix-2', pr: 2, prMinutes: 6, symptom: 'a | b' })], 'o/r');
  assert.ok(md.includes('[#1](https://github.com/o/r/pull/1) | 1.5 h |'));
  assert.ok(md.includes('| 6 min |'));
  assert.ok(md.includes('a \\| b'));
});

test('docs/fixes.md is the current output (run npm run policy)', () => {
  assert.equal(fs.readFileSync(path.join(packageRoot, 'docs', 'fixes.md'), 'utf8'), fixesMarkdown(readFixes()));
});
