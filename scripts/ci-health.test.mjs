// Tests for the daily CI health check (scripts/ci-health.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, missing, report } from './ci-health.mjs';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const run = (conclusion, hoursAgo, extra = {}) => ({
  status: 'completed', conclusion, event: 'schedule',
  created_at: new Date(NOW - hoursAgo * 3600_000).toISOString(), html_url: `https://example.test/${hoursAgo}`, ...extra,
});

test('the latest finished run decides: a failure is failing even after older successes', () => {
  assert.equal(assess('CI', [run('failure', 1), run('success', 5)], {}, NOW).state, 'failing');
  assert.equal(assess('CI', [run('success', 1), run('failure', 5)], {}, NOW).state, 'ok');
  for (const c of ['timed_out', 'startup_failure']) assert.equal(assess('CI', [run(c, 1)], {}, NOW).state, 'failing', c);
});

test('cancelled, skipped and unfinished runs are passed over', () => {
  const runs = [run(null, 0, { status: 'in_progress' }), run('cancelled', 1), run('skipped', 2), run('failure', 3)];
  assert.equal(assess('CI', runs, {}, NOW).state, 'failing');
  assert.equal(assess('CI', [run('cancelled', 1), run('success', 2)], {}, NOW).state, 'ok');
});

test('a scheduled workflow is overdue past its limit, and only then', () => {
  assert.equal(assess('CI', [run('success', 25)], { CI: 26 }, NOW).state, 'ok');
  assert.equal(assess('CI', [run('success', 27)], { CI: 26 }, NOW).state, 'overdue');
  assert.equal(assess('Release', [run('success', 500)], { CI: 26 }, NOW).state, 'ok', 'no limit, no overdue');
  assert.equal(assess('CI', [], { CI: 26 }, NOW).state, 'overdue', 'a scheduled workflow that never ran');
  assert.equal(assess('Eval', [], {}, NOW).state, 'never run', 'a manual one is just reported');
});

test('a watched scheduled workflow that no longer exists is reported', () => {
  assert.deepEqual(missing(['Dashboard'], { CI: 26 }).map((r) => [r.workflow, r.state]), [['CI', 'missing']]);
  assert.deepEqual(missing(['CI'], { CI: 26 }), []);
});

test('the report counts problems and lists every workflow', () => {
  const results = [{ repo: 'me/a', rows: [assess('CI', [run('failure', 1)], {}, NOW), assess('Docs', [run('success', 1)], {}, NOW)] }];
  const { problems, markdown } = report(results, new Date(NOW));
  assert.equal(problems.length, 1);
  assert.match(markdown, /^\*\*1 problem\*\* on 2026-10-18:/);
  assert.match(markdown, /\| a \| CI \| \*\*failing\*\* \| \[failure, /);
  assert.match(markdown, /\| a \| Docs \| ok \|/);
  assert.match(report([{ repo: 'me/a', rows: [assess('Docs', [run('success', 1)], {}, NOW)] }], new Date(NOW)).markdown, /^All green/);
});
