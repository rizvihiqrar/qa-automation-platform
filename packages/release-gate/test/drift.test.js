import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { baseline, checkDrift, formatDrift, metricsFromK6, metricsFromPlaywright } from '../src/drift.js';
import { parseArgs, run } from '../src/drift-cli.js';

const CLI = fileURLToPath(new URL('../src/drift-cli.js', import.meta.url));
const fx = (f) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'));
const runs = (values, name = 'durationMs') => values.map((v, i) => ({ label: `r${i}`, metrics: { [name]: v } }));
const NOISY = [100, 104, 98, 101, 103, 99, 102, 100, 97, 105];

test('metricsFromPlaywright reads the totals and the per-test times from a real report', () => {
  const m = metricsFromPlaywright(JSON.parse(fs.readFileSync(fx('smoke-playwright.json'), 'utf8')));
  assert.equal(m.tests, 10);
  assert.equal(m.failed, 0);
  assert.ok(m.slowestTestMs >= m.medianTestMs && m.medianTestMs > 0, JSON.stringify(m));
});

test('metricsFromK6 reads p95, the average and the failed request rate, and skips what is missing', () => {
  const m = metricsFromK6(JSON.parse(fs.readFileSync(fx('k6-load.json'), 'utf8')));
  assert.ok(m.p95Ms > 0 && m.avgMs > 0);
  assert.equal(m.errorRate, 0);
  assert.deepEqual(metricsFromK6({ metrics: {} }), {});
});

test('the limit comes from the history: a small wobble is noise, a big slowdown is drift', () => {
  assert.deepEqual(checkDrift(runs(NOISY), { durationMs: 106 }), []);
  const alerts = checkDrift(runs(NOISY), { durationMs: 160 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].metric, 'durationMs');
  assert.ok(alerts[0].limit < 160 && alerts[0].limit > 105, `limit ${alerts[0].limit}`);
});

test('a metric that never moved gets a floor, so one tick is not an alert but 30 percent is', () => {
  const flat = runs(Array(10).fill(100));
  assert.deepEqual(checkDrift(flat, { durationMs: 101 }), []);
  assert.equal(checkDrift(flat, { durationMs: 130 }).length, 1);
});

test('faster is never drift', () => {
  assert.deepEqual(checkDrift(runs(NOISY), { durationMs: 20 }), []);
});

test('failed and flaky tests alert on the first one, when none were ever seen', () => {
  const history = runs(Array(10).fill(0), 'failed');
  assert.deepEqual(checkDrift(history, { failed: 0 }), []);
  assert.equal(checkDrift(history, { failed: 1 })[0].metric, 'failed');
});

test('a count that was already sometimes high is judged against the most seen before', () => {
  const history = runs([0, 1, 0, 1, 0, 0, 0, 1, 0, 0], 'flaky');
  assert.deepEqual(checkDrift(history, { flaky: 1 }), []);
  assert.equal(checkDrift(history, { flaky: 2 }).length, 1);
});

test('the number of tests run must match, up or down', () => {
  const history = runs(Array(10).fill(11), 'tests');
  assert.deepEqual(checkDrift(history, { tests: 11 }), []);
  assert.match(checkDrift(history, { tests: 9 })[0].reason, /9 tests ran, usually 11/);
  assert.equal(checkDrift(history, { tests: 12 }).length, 1);
});

test('too little history is refused instead of guessed at', () => {
  assert.throws(() => baseline(runs([1, 2, 3])), /at least 10 are needed/);
  assert.throws(() => checkDrift(runs([1, 2, 3, 4, 5, 6, 7, 8, 9]), { durationMs: 1 }), /"durationMs"/);
});

test('a metric the history does not know is skipped, not alerted', () => {
  assert.deepEqual(checkDrift(runs(NOISY), { durationMs: 100, p95Ms: 9999 }), []);
});

test('the report names each drifting metric and says no drift when clean', () => {
  const md = formatDrift(checkDrift(runs(NOISY), { durationMs: 160 }), { label: '1.5.0' });
  assert.match(md, /Release drift for 1\.5\.0: ⚠ DRIFT/);
  assert.match(md, /\| Whole smoke run \(ms\) \| 160 \|/);
  assert.match(formatDrift([]), /✅ no drift/);
});

test('parseArgs checks its arguments', () => {
  assert.throws(() => parseArgs(['--playwright', 'a.json']), /--history is required/);
  assert.throws(() => parseArgs(['--history', 'h.json']), /at least one result/);
  assert.throws(() => parseArgs(['--history', 'h.json', '--playwright']), /needs a value/);
  assert.throws(() => parseArgs(['--history', 'h.json', '--playwright', 'a.json', '--record']), /needs a --label/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});

test('--record starts a history, then checks each new run and records only clean ones', () => {
  const dir = tmpDir();
  const history = path.join(dir, 'h.json');
  const base = { history, playwright: fx('smoke-playwright.json'), k6: null, json: null, record: true };
  for (let i = 0; i < 10; i++) assert.equal(run({ ...base, label: `r${i}` }).recorded, true);
  assert.equal(JSON.parse(fs.readFileSync(history, 'utf8')).runs.length, 10);
  const clean = run({ ...base, label: 'r10' });
  assert.deepEqual(clean.alerts, []);
  assert.equal(clean.recorded, true);

  const slow = JSON.parse(fs.readFileSync(fx('smoke-playwright.json'), 'utf8'));
  slow.stats.duration *= 2;
  const slowFile = path.join(dir, 'slow.json');
  fs.writeFileSync(slowFile, JSON.stringify(slow));
  const drifted = run({ ...base, playwright: slowFile, label: 'slow' });
  assert.equal(drifted.alerts[0].metric, 'durationMs');
  assert.equal(drifted.recorded, false);
  assert.equal(JSON.parse(fs.readFileSync(history, 'utf8')).runs.length, 11);
});

test('the command exits 1 on drift, writes { passed, summary } for the gate and exits 2 on bad input', () => {
  const dir = tmpDir();
  const history = path.join(dir, 'h.json');
  const report = JSON.parse(fs.readFileSync(fx('smoke-playwright.json'), 'utf8'));
  fs.writeFileSync(history, JSON.stringify({ runs: Array.from({ length: 10 }, (_, i) => ({ label: `r${i}`, metrics: metricsFromPlaywright(report) })) }));
  const slow = structuredClone(report);
  slow.stats.duration *= 2;
  const slowFile = path.join(dir, 'slow.json');
  fs.writeFileSync(slowFile, JSON.stringify(slow));
  const out = path.join(dir, 'out.json');
  const env = { ...process.env, GITHUB_STEP_SUMMARY: '' };

  const ok = spawnSync(process.execPath, [CLI, '--history', history, '--playwright', fx('smoke-playwright.json'), '--json', out], { encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).passed, true);

  const bad = spawnSync(process.execPath, [CLI, '--history', history, '--playwright', slowFile, '--json', out], { encoding: 'utf8', env });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /DRIFT/);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).passed, false);

  assert.equal(spawnSync(process.execPath, [CLI, '--bogus'], { encoding: 'utf8', env }).status, 2);
});

// The proof on real data: drift/history.json holds 20 real smoke runs of qa-practice-api (11 tests each).
const HISTORY = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../drift/history.json', import.meta.url)), 'utf8')).runs;
const withoutRun = (i) => HISTORY.filter((_, j) => j !== i);

test('the history is 20 real runs of the same 11 smoke tests, none failed or flaky', () => {
  assert.equal(HISTORY.length, 20);
  assert.ok(HISTORY.every((r) => r.metrics.tests === 11 && r.metrics.failed === 0 && r.metrics.flaky === 0));
});

test('20 clean runs raise no alert, each one checked against the other 19', () => {
  HISTORY.forEach((run, i) => assert.deepEqual(checkDrift(withoutRun(i), run.metrics), [], run.label));
});

test('a seeded slowdown (every time 5 times longer) raises an alert on each of the 20 runs', () => {
  HISTORY.forEach((run, i) => {
    const slow = { ...run.metrics, durationMs: run.metrics.durationMs * 5, slowestTestMs: run.metrics.slowestTestMs * 5, medianTestMs: run.metrics.medianTestMs * 5 };
    const alerts = checkDrift(withoutRun(i), slow);
    assert.ok(alerts.some((a) => a.metric === 'durationMs'), `${run.label}: ${JSON.stringify(alerts)}`);
  });
});

test('a seeded failure, a lost test and a new flaky test each raise an alert on every run', () => {
  HISTORY.forEach((run, i) => {
    const others = withoutRun(i);
    assert.equal(checkDrift(others, { ...run.metrics, failed: 1 })[0].metric, 'failed');
    assert.equal(checkDrift(others, { ...run.metrics, tests: 10 })[0].metric, 'tests');
    assert.equal(checkDrift(others, { ...run.metrics, flaky: 1 })[0].metric, 'flaky');
  });
});

test('a metric most past runs did not record is left out, it does not stop the check', () => {
  const history = [...runs(NOISY), ...NOISY.slice(0, 3).map((v, i) => ({ label: `k${i}`, metrics: { durationMs: v, p95Ms: 30 } }))];
  assert.deepEqual(checkDrift(history, { durationMs: 101, p95Ms: 5000 }), []);
  assert.equal(checkDrift(history, { durationMs: 400, p95Ms: 5000 })[0].metric, 'durationMs');
});

test('a median of 0 still leaves room: 1 is not drift, a real jump is', () => {
  const history = runs(Array(10).fill(0), 'medianTestMs');
  assert.deepEqual(checkDrift(history, { medianTestMs: 1 }), []);
  assert.equal(checkDrift(history, { medianTestMs: 50 }).length, 1);
});

test('skipped tests have no time to count and are not in the total', () => {
  const report = { stats: { duration: 100, expected: 2, unexpected: 0, flaky: 0, skipped: 3 }, suites: [{ specs: [
    { tests: [{ status: 'expected', results: [{ duration: 40 }] }, { status: 'expected', results: [{ duration: 60 }] }] },
    { tests: [{ status: 'skipped', results: [] }, { status: 'skipped', results: [{ duration: 0 }] }] },
  ] }] };
  const m = metricsFromPlaywright(report);
  assert.equal(m.tests, 2);
  assert.equal(m.medianTestMs, 50);
});

test('a run with failures cannot start a history', () => {
  const dir = tmpDir();
  const report = JSON.parse(fs.readFileSync(fx('smoke-playwright.json'), 'utf8'));
  report.stats.unexpected = 2;
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, JSON.stringify(report));
  assert.throws(() => run({ history: path.join(dir, 'h.json'), playwright: file, k6: null, json: null, record: true, label: 'x' }), /cannot start a history/);
  assert.equal(fs.existsSync(path.join(dir, 'h.json')), false);
});

test('a history of Playwright runs checked with k6 numbers is a start, not a crash', () => {
  const dir = tmpDir();
  const history = path.join(dir, 'h.json');
  fs.writeFileSync(history, JSON.stringify({ runs: runs(NOISY.concat(NOISY)) }));
  const k6 = path.join(dir, 'k6.json');
  fs.writeFileSync(k6, fs.readFileSync(fx('k6-load.json')));
  const result = run({ history, playwright: null, k6, json: null, record: false, label: null });
  assert.deepEqual(result.alerts, []);
  assert.match(result.markdown, /nothing to compare with yet/);
});
