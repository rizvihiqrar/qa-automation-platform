// Tests for the daily CI health check (scripts/ci-health.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WATCH, api, assess, fixedBy, manualOnly, missing, passRate, PROBLEMS, REACTIVE, report, rerunRow, reruns, settle, triggers } from './ci-health.mjs';

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
  assert.deepEqual(manual, ['ai-eval.yml', 'release.yml', 'variance.yml', 'visual-baselines.yml']);
});

// A workflow that runs on a schedule and is not listed in WATCH can stop for 60 days (GitHub switches
// schedules off in a quiet repo) or fail every time, and nobody is told. CI health does not watch itself.
test('every scheduled workflow in this repo is watched for being overdue', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const scheduled = fs.readdirSync(dir)
    .map((f) => fs.readFileSync(new URL(f, dir), 'utf8'))
    .filter((yaml) => triggers(yaml).includes('schedule'))
    .map((yaml) => yaml.match(/^name:[ \t]*(.+?)[ \t\r]*$/m)[1])
    .filter((name) => name !== 'CI health');
  const watched = Object.keys(WATCH.find((w) => w.repo === 'rizvihiqrar/qa-automation-platform').overdueAfterHours);
  assert.deepEqual(scheduled.filter((n) => !watched.includes(n)), [], 'add it to WATCH in scripts/ci-health.mjs');
});

test('Monitor, run every 30 minutes, is overdue after 3 hours without a run', () => {
  const { overdueAfterHours } = WATCH.find((w) => w.repo === 'rizvihiqrar/qa-automation-platform');
  assert.equal(overdueAfterHours.Monitor, 3);
  assert.equal(assess('Monitor', [run('success', 2.9)], overdueAfterHours, NOW).state, 'ok');
  assert.equal(assess('Monitor', [run('success', 3.1)], overdueAfterHours, NOW).state, 'overdue');
  assert.equal(assess('Monitor', [run('failure', 0.5)], overdueAfterHours, NOW).state, 'failing', 'a broken monitor is a problem');
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

test('a re-run stops being a problem once a fix merged after it names the run', () => {
  const r = run('success', 5, { id: 40206566126, run_attempt: 2 });
  const pr = (number, hoursAgo, ...texts) => ({ number, merged_at: new Date(NOW - hoursAgo * 3600_000).toISOString(), texts });
  const fix = pr(88, 1, 'Run 40206566126 attempt 1: DC-ST-06 failed');
  assert.equal(fixedBy(r, [pr(87, 2, 'unrelated', null), fix])?.number, 88);
  assert.equal(fixedBy(r, [pr(85, 1, 'body', 'Fixes the re-run of run 40206566126.')])?.number, 85, 'a comment counts too');
  assert.equal(fixedBy(r, [pr(80, 6, 'Run 40206566126')]), undefined, 'merged before the run: not its fix');
  assert.equal(fixedBy(r, [pr(81, 1, 'Run 402065661260 and 140206566126')]), undefined, 'a longer number is another run');
  assert.equal(fixedBy(r, [{ number: 82, merged_at: null, texts: ['40206566126'] }]), undefined, 'closed without merging');

  const row = rerunRow('CI', r, [{ name: 'qa-practice-api', conclusion: 'failure' }], fix);
  assert.equal(row.state, 'fixed');
  assert.match(row.detail, /qa-practice-api failed on attempt 1.*; fixed in #88$/);
  const { problems, markdown } = report([{ repo: 'me/a', rows: [assess('CI', [r], {}, NOW), row] }], new Date(NOW));
  assert.deepEqual(problems, []);
  assert.match(markdown, /^All green[\s\S]*\| CI \| fixed: qa-practice-api failed on attempt 1.*; fixed in #88 \|/);
});

test('the workflow runs after CI on main without emailing, and keeps the status issue closed', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/ci-health.yml', import.meta.url), 'utf8');
  assert.deepEqual(triggers(yml), ['schedule', 'workflow_run', 'workflow_dispatch']);
  assert.match(yml, /workflow_run:\s+workflows: \[CI\]\s+types: \[completed\]\s+branches: \[main\]/);
  // After CI, the ci-health issue only gets its body refreshed or is closed: comments are daily.
  assert.match(yml, /if \[ "\$DAILY" = "true" \]; then gh issue comment "\$open"/);
  assert.equal(yml.match(/gh issue comment "\$open"/g).length, 1, 'no other comment on the ci-health issue');
  // The daily status is posted only on the daily (and hand-started) runs, to a closed issue.
  const status = yml.slice(yml.indexOf('- name: Post the daily status'));
  assert.match(status, /^- name: Post the daily status\s+if: \$\{\{ github\.event_name != 'workflow_run' \}\}/);
  assert.match(status, /--state all/);
  assert.match(status, /gh issue close "\$status"/);
});

test('api retries a dropped connection and a 5xx, then returns the data', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) throw new TypeError('fetch failed');
    if (calls === 2) return { ok: false, status: 502, text: async () => 'bad gateway' };
    return { ok: true, status: 200, json: async () => ({ fine: true }) };
  };
  assert.deepEqual(await api('/x', 't', { fetchImpl, waitMs: 0 }), { fine: true });
  assert.equal(calls, 3);
});

test('api gives up after the last try and does not retry a 404', async () => {
  let calls = 0;
  const down = async () => { calls++; throw new TypeError('fetch failed'); };
  await assert.rejects(api('/x', 't', { fetchImpl: down, tries: 3, waitMs: 0 }), /fetch failed/);
  assert.equal(calls, 3);
  calls = 0;
  const missing404 = async () => { calls++; return { ok: false, status: 404, text: async () => 'nope' }; };
  await assert.rejects(api('/x', 't', { fetchImpl: missing404, waitMs: 0 }), /404/);
  assert.equal(calls, 1);
});

test('api throws the 5xx body when the last try is still a 5xx, and waits longer each time', async () => {
  const waits = [];
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { waits.push(ms); return realSet(fn, 0); };
  try {
    let calls = 0;
    const bad = async () => { calls++; return { ok: false, status: 503, text: async () => 'unavailable' }; };
    await assert.rejects(api('/x', 't', { fetchImpl: bad, tries: 3, waitMs: 10 }), /503 unavailable/);
    assert.equal(calls, 3);
    assert.deepEqual(waits, [10, 20]);
  } finally {
    globalThis.setTimeout = realSet;
  }
});

// 2026-10-31: CI recheck confirmed a failure, CI went green after the fix, and the ci-health
// issue stayed open because nothing re-runs CI recheck and its latest run was still the failure.
const failingRecheck = { workflow: 'CI recheck', state: 'failing', conclusion: 'failure', url: 'https://example.test/r', at: '2026-10-31T09:28:00Z', event: 'workflow_run', passed: 4, total: 5 };
const okRow = (workflow) => ({ workflow, state: 'ok', conclusion: 'success' });

test('a failed CI recheck stops counting once every other workflow is green', () => {
  const rows = settle([okRow('CI'), okRow('Dashboard'), failingRecheck]);
  const recheck = rows.find((r) => r.workflow === 'CI recheck');
  assert.equal(recheck.state, 'resolved');
  assert.ok(!PROBLEMS.includes(recheck.state));
  const { problems, markdown } = report([{ repo: 'me/a', rows }], new Date(NOW));
  assert.equal(problems.length, 0);
  assert.match(markdown, /^All green[\s\S]*\| CI recheck \| resolved: diagnosed a failure on main/);
});

test('a failed CI recheck stays failing while anything else is still a problem', () => {
  for (const bad of ['failing', 'overdue', 'missing', 're-run']) {
    const rows = settle([{ ...okRow('CI'), state: bad }, failingRecheck]);
    assert.equal(rows.find((r) => r.workflow === 'CI recheck').state, 'failing', bad);
  }
});

test('only the reactive workflow is settled, and only its failures', () => {
  const rows = settle([{ ...okRow('CI'), state: 'failing' }, okRow('Dashboard')]);
  assert.equal(rows[0].state, 'failing', 'a real failing workflow is never settled');
  assert.deepEqual(settle([okRow('CI recheck')]), [okRow('CI recheck')], 'a passing recheck is left alone');
  const lookalike = settle([okRow('CI'), { ...failingRecheck, workflow: 'Monitor' }]);
  assert.equal(lookalike[1].state, 'failing', 'a workflow that merely failed is not reactive');
});

test('every repo\'s rows go through settle before the report is built', () => {
  const src = fs.readFileSync(new URL('./ci-health.mjs', import.meta.url), 'utf8');
  assert.match(src, /results\.push\(\{ repo, rows: settle\(rows\) \}\)/);
});

test('the reactive names match the workflow files', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/ci-recheck.yml', import.meta.url), 'utf8');
  for (const name of REACTIVE) assert.match(yml, new RegExp(`^name: ${name}\\s*$`, 'm'), `${name} must be the name of a workflow file`);
});
