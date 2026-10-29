import assert from 'node:assert/strict';
import { test } from 'node:test';
import { append, DOWN_AFTER, KEEP_DAYS, median, MIN_SAMPLES, summarize, type History, type Run, type SiteResult } from '../../src/history.ts';

const START = Date.parse('2026-10-01T00:00:00Z');
const at = (n: number) => new Date(START + n * 30 * 60_000).toISOString(); // run n, 30 minutes apart
const pass = (ms: number, attempts = 1): SiteResult => ({ ok: true, ms, attempts });
const fail = (error = 'timeout'): SiteResult => ({ ok: false, ms: null, error, attempts: 2 });
const run = (n: number, result: SiteResult): Run => ({ t: at(n), results: { demo: result } });
const history = (...results: SiteResult[]): History => ({ runs: results.map((r, n) => run(n, r)) });
const steady = (n: number, ms = 200) => Array.from({ length: n }, () => pass(ms));
const one = (h: History) => summarize(h)[0]!;

test('a site that passes its last run is up, with its uptime and median', () => {
  const s = one(history(pass(100), pass(300), pass(200)));
  assert.equal(s.status, 'up');
  assert.equal(s.uptimePct, 100);
  assert.equal(s.medianMs, 200); // the runs before the latest one: 100 and 300
  assert.equal(s.latestMs, 200);
  assert.equal(s.failingSince, null);
});

test('one failed run is degraded, not down', () => {
  const s = one(history(...steady(3), fail('HTTP 503')));
  assert.equal(s.status, 'degraded');
  assert.equal(s.lastError, 'HTTP 503');
  assert.equal(s.latestMs, null);
});

test('two failed runs in a row make a site down, from the first of them', () => {
  const s = one(history(...steady(3), fail('timeout'), fail('HTTP 503')));
  assert.equal(DOWN_AFTER, 2);
  assert.equal(s.status, 'down');
  assert.equal(s.failingSince, at(3));
  assert.equal(s.lastError, 'HTTP 503');
});

test('two failures that are not in a row are not down', () => {
  assert.equal(one(history(pass(100), fail(), pass(100), fail())).status, 'degraded');
});

test('a pass after the failures is up again and clears the failing streak', () => {
  const s = one(history(...steady(3), fail(), fail(), pass(210)));
  assert.equal(s.status, 'up');
  assert.equal(s.failingSince, null);
  assert.equal(s.lastError, null);
});

test('uptime counts every run in the history', () => {
  const s = one(history(pass(1), pass(1), pass(1), fail()));
  assert.equal(s.uptimePct, 75);
  assert.equal(s.runs, 4);
});

test('slow means more than 3 times the median of the runs before it', () => {
  assert.equal(MIN_SAMPLES, 10);
  assert.equal(one(history(...steady(12, 200), pass(601))).slow, true);
  assert.equal(one(history(...steady(12, 200), pass(600))).slow, false); // exactly 3 times is not more
  assert.equal(one(history(...steady(12, 200), pass(450))).slow, false);
});

test('a very slow load does not lift the median it is judged against', () => {
  const s = one(history(...steady(12, 200), pass(5000)));
  assert.equal(s.medianMs, 200);
  assert.equal(s.slow, true);
});

test('slow needs enough history: 9 earlier runs is too few', () => {
  assert.equal(one(history(...steady(9, 200), pass(5000))).slow, false);
  assert.equal(one(history(...steady(10, 200), pass(5000))).slow, true);
});

test('each site is slow against its own median', () => {
  const runs: Run[] = Array.from({ length: 12 }, (_, n) => ({ t: at(n), results: { fast: pass(100), steady: pass(1500) } }));
  runs.push({ t: at(12), results: { fast: pass(400), steady: pass(1600) } });
  const [fast, steady] = summarize({ runs });
  assert.equal(fast!.slow, true); // 400 is 4 times its own 100
  assert.equal(steady!.slow, false); // 1600 would be slow for fast, but not for this site
});

test('a down site is not also slow', () => {
  assert.equal(one(history(...steady(12), fail())).slow, false);
});

test('the history keeps 30 days: older runs are dropped when a new one is added', () => {
  assert.equal(KEEP_DAYS, 30);
  const old: Run = { t: '2026-09-01T00:00:00Z', results: { demo: pass(1) } };
  const edge: Run = { t: '2026-09-02T00:00:00Z', results: { demo: pass(1) } }; // exactly 30 days before the new run
  const justOutside: Run = { t: '2026-09-01T23:59:59Z', results: { demo: pass(1) } };
  const fresh: Run = { t: '2026-10-02T00:00:00Z', results: { demo: pass(1) } };
  const kept = append({ runs: [old, justOutside, edge] }, fresh).runs.map((r) => r.t);
  assert.deepEqual(kept, [edge.t, fresh.t]);
});

test('append does not change the history it was given', () => {
  const before = history(pass(1));
  append(before, run(1, pass(2)));
  assert.equal(before.runs.length, 1);
});

test('the series is the last 48 load times, with null where the site was down', () => {
  const s = one(history(...steady(60, 100), fail(), pass(120)));
  assert.equal(s.series.length, 48);
  assert.equal(s.series.at(-1), 120);
  assert.equal(s.series.at(-2), null);
});

test('median of an even count is the rounded middle pair; of nothing it is null', () => {
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([]), null);
});

test('an empty history summarizes to nothing', () => {
  assert.deepEqual(summarize({ runs: [] }), []);
});
