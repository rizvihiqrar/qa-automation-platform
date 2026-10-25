// Tests for the daily CI health check (scripts/ci-health.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assess, manualOnly, missing, passRate, PROBLEMS, report, rerunRow, reruns, triggers } from './ci-health.mjs';

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
  assert.equal(assess('Eval', [], {}, NOW).state, 'never run', 'not scheduled, not manual: just reported');
});

test('a workflow started only by hand is "manual" until it runs, and never a problem', () => {
  const row = assess('AI generator eval', [run('skipped', 1)], {}, NOW, { manual: true });
  assert.equal(row.state, 'manual');
  assert.ok(!PROBLEMS.includes(row.state));
  assert.match(report([{ repo: 'me/a', rows: [row] }], new Date(NOW)).markdown, /^All green[\s\S]*\| AI generator eval \| manual \|/);
  assert.equal(assess('AI generator eval', [run('failure', 1)], {}, NOW, { manual: true }).state, 'failing', 'a failed manual run still counts');
});

test('triggers reads every form of on:, and only workflow_dispatch alone is manual', () => {
  const forms = {
    'on: workflow_dispatch\n': ['workflow_dispatch'],
    'on: [push, workflow_dispatch]\n': ['push', 'workflow_dispatch'],
    'name: x\n\non:\n  workflow_dispatch:\n    inputs:\n      label:\n        default: run-1\n\njobs:\n  eval:\n': ['workflow_dispatch'],
    'on:\r\n  schedule:\r\n    - cron: 1 * * * *\r\n  workflow_dispatch:\r\njobs:\r\n': ['schedule', 'workflow_dispatch'],
    'on:\n  - push\n  - workflow_dispatch\n': ['push', 'workflow_dispatch'],
  };
  for (const [yaml, events] of Object.entries(forms)) assert.deepEqual(triggers(yaml), events, yaml);
  assert.equal(manualOnly(['workflow_dispatch']), true);
  assert.equal(manualOnly(['schedule', 'workflow_dispatch']), false);
  assert.equal(manualOnly([]), false, 'no on: found is not manual');
});

test('every workflow in this repo reads as the trigger its file says', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const manual = fs.readdirSync(dir).filter((f) => manualOnly(triggers(fs.readFileSync(new URL(f, dir), 'utf8'))));
  assert.deepEqual(manual, ['ai-eval.yml', 'release.yml', 'variance.yml']);
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
  assert.match(markdown, /\| a \| CI \| \*\*failing\*\* \| 0% \(0\/1\) \| \[failure, /);
  assert.match(markdown, /\| a \| Docs \| ok \| 100% \(1\/1\) \|/);
  assert.match(report([{ repo: 'me/a', rows: [assess('Docs', [run('success', 1)], {}, NOW)] }], new Date(NOW)).markdown, /^All green/);
});

test('the pass rate counts finished runs only', () => {
  const r = assess('CI', [run('success', 1), run('cancelled', 2), run('failure', 3), run('success', 4), run('success', 5)], {}, NOW);
  assert.deepEqual([r.passed, r.total], [3, 4]);
  assert.equal(passRate(3, 4), '75% (3/4)');
  assert.equal(passRate(0, 0), '–');
});

test('packages from the dashboard are listed with a passing-now count', () => {
  const packages = [
    { name: 'k6-performance', results: 20, passRate: 95, latest: 'success' },
    { name: 'graphql-test-suite', results: 10, passRate: 90, latest: 'failure' },
  ];
  const { markdown } = report([], new Date(NOW), packages);
  assert.match(markdown, /\*\*Packages\*\* .*: 1\/2 passing now/);
  assert.match(markdown, /\| k6-performance \| success \| 95% \(19\/20\) \|/);
  assert.match(markdown, /\| graphql-test-suite \| \*\*failure\*\* \| 90% \(9\/10\) \|/);
  assert.doesNotMatch(report([], new Date(NOW)).markdown, /Packages/);
});

test('a run on main that needed a re-run in the last day is flagged', () => {
  const runs = [
    run('success', 2, { id: 1, run_attempt: 2 }), // CI recheck re-ran a failed job: flagged
    run('success', 3, { id: 2, run_attempt: 1 }), // passed first time
    run('success', 30, { id: 3, run_attempt: 2, run_started_at: new Date(NOW - 30 * 3600_000).toISOString() }), // too old
    run('success', 30, { id: 4, run_attempt: 3, run_started_at: new Date(NOW - 1 * 3600_000).toISOString() }), // old run, re-run today
    run('success', 4, { id: 5 }), // no attempt field: one attempt
  ];
  assert.deepEqual(reruns(runs, NOW).map((r) => r.id), [1, 4]);
});

test('the re-run row names the jobs that failed on the first attempt and is a problem', () => {
  const r = run('success', 2, { id: 9, run_attempt: 2 });
  const jobs = [{ name: 'llm-judge-check', conclusion: 'failure' }, { name: 'typecheck', conclusion: 'success' }, { name: 'k6', conclusion: 'timed_out' }];
  const row = rerunRow('CI', r, jobs);
  assert.equal(row.state, 're-run');
  assert.equal(row.detail, 'llm-judge-check, k6 failed on attempt 1, run took 2 attempts (success in the end)');
  const { problems, markdown } = report([{ repo: 'me/a', rows: [assess('CI', [r], {}, NOW), row] }], new Date(NOW));
  assert.deepEqual(problems.map((p) => p.state), ['re-run']);
  assert.match(markdown, /\| a \| CI \| \*\*re-run\*\*: llm-judge-check, k6 failed on attempt 1/);
  assert.equal(rerunRow('CI', r, []).detail.startsWith('no failed job recorded'), true);
});
