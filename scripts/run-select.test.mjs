// Tests for picking runs from an unfiltered list (scripts/run-select.mjs), and a check that
// the scripts never ask GitHub to filter the list themselves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lastGreenBefore, onMain } from './run-select.mjs';

const run = (id, head_branch, conclusion, created_at) => ({ id, head_branch, status: 'completed', conclusion, created_at });
const LIST = [
  run(5, 'main', 'failure', '2026-10-22T16:00:00Z'),
  run(4, 'feature', 'success', '2026-10-22T15:00:00Z'),
  run(3, 'main', 'cancelled', '2026-10-22T14:00:00Z'),
  run(2, 'main', 'success', '2026-10-22T13:00:00Z'),
  run(1, 'main', 'success', '2026-10-22T12:00:00Z'),
];

test('onMain keeps main runs in order and drops other branches', () => {
  assert.deepEqual(onMain(LIST).map((r) => r.id), [5, 3, 2, 1]);
  assert.deepEqual(onMain([]), []);
});

test('lastGreenBefore is the newest green run on main before the given time', () => {
  assert.equal(lastGreenBefore(LIST, '2026-10-22T16:00:00Z').id, 2, 'skips the feature branch and the cancelled run');
  assert.equal(lastGreenBefore(LIST, '2026-10-22T13:00:00Z').id, 1, 'strictly before');
  assert.equal(lastGreenBefore(LIST, '2026-10-22T12:00:00Z'), undefined, 'nothing earlier');
});

test('no script asks GitHub to filter a run list (?branch=, status=, created=)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const filtered = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).flatMap((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)
      .map((line, i) => ({ where: `${f}:${i + 1}`, line }))
      .filter(({ line }) => /\/runs\?[^`'"]*\b(branch|status|created|event|actor)=/.test(line)));
  assert.deepEqual(filtered.map((c) => c.where), [], 'list unfiltered and select the runs in code (run-select.mjs)');
});
