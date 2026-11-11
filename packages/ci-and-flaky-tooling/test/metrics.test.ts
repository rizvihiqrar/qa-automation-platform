import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flakyRate, inMonth, quantile, runTime, timeToFixRedMain, type Run } from '../src/metrics.ts';

let id = 0;
// A run created at `at`, lasting `minutes`, with the given result and attempt.
const run = (at: string, conclusion: string | null, extra: { attempt?: number; minutes?: number; firstAttempt?: string | null } = {}): Run => {
  const end = new Date(Date.parse(at) + (extra.minutes ?? 10) * 60_000).toISOString();
  const attempt = extra.attempt ?? 1;
  // a run that was re-run is, unless a test says otherwise, one whose first attempt failed
  return { id: ++id, createdAt: at, startedAt: at, updatedAt: end, attempt, conclusion, firstAttempt: extra.firstAttempt === undefined ? (attempt > 1 ? 'failure' : null) : extra.firstAttempt };
};

test('quantile picks the middle and interpolates between two runs', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([5], 0.9), 5);
  assert.equal(quantile([1, 3], 0.5), 2);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
});

test('inMonth keeps only runs created in that calendar month', () => {
  const runs = [run('2026-10-31T23:59:59Z', 'success'), run('2026-11-01T00:00:00Z', 'success'), run('2026-11-30T23:59:59Z', 'success'), run('2026-12-01T00:00:00Z', 'success')];
  assert.deepEqual(inMonth(runs, '2026-11').map((r) => r.createdAt.slice(0, 10)), ['2026-11-01', '2026-11-30']);
});

test('flaky rate counts runs that were green only on a later attempt', () => {
  const result = flakyRate([
    run('2026-11-01T10:00:00Z', 'success'),
    run('2026-11-02T10:00:00Z', 'success', { attempt: 2 }),
    run('2026-11-03T10:00:00Z', 'success'),
    run('2026-11-04T10:00:00Z', 'success'),
  ]);
  assert.deepEqual(result, { flaky: 1, total: 4, rate: 0.25 });
});

test('a green run that someone ran again is not flaky, because its first attempt passed (the break: count every attempt above 1)', () => {
  const result = flakyRate([run('2026-11-01T10:00:00Z', 'success', { attempt: 2, firstAttempt: 'success' }), run('2026-11-02T10:00:00Z', 'success')]);
  assert.equal(result.flaky, 0);
  assert.equal(result.total, 2);
});

test('a run that was re-run and stayed red is a failure, not a flaky run', () => {
  const result = flakyRate([run('2026-11-01T10:00:00Z', 'failure', { attempt: 2 }), run('2026-11-02T10:00:00Z', 'success')]);
  assert.equal(result.flaky, 0);
  assert.equal(result.total, 2);
});

test('cancelled, skipped and unfinished runs are left out of every count', () => {
  const runs = [run('2026-11-01T10:00:00Z', 'cancelled', { attempt: 2 }), run('2026-11-02T10:00:00Z', 'skipped'), run('2026-11-03T10:00:00Z', null), run('2026-11-04T10:00:00Z', 'success')];
  assert.deepEqual(flakyRate(runs), { flaky: 0, total: 1, rate: 0 });
  assert.equal(runTime(runs).count, 1);
  assert.deepEqual(timeToFixRedMain(runs, '2026-11-05T00:00:00Z'), { fixHours: [], medianHours: null, stillRed: null });
});

test('flaky rate with no runs is no number, not zero', () => {
  assert.deepEqual(flakyRate([]), { flaky: 0, total: 0, rate: null });
});

test('time to fix is from the first red run to the start of the next green run', () => {
  const result = timeToFixRedMain([
    run('2026-11-01T08:00:00Z', 'success'),
    run('2026-11-01T09:00:00Z', 'failure'),
    run('2026-11-01T13:00:00Z', 'success'),
  ], '2026-11-02T00:00:00Z');
  assert.deepEqual(result.fixHours, [4]);
  assert.equal(result.medianHours, 4);
  assert.equal(result.stillRed, null);
});

test('several failed runs in a row are one red, measured from the first', () => {
  const result = timeToFixRedMain([
    run('2026-11-01T09:00:00Z', 'failure'),
    run('2026-11-01T10:00:00Z', 'failure'),
    run('2026-11-01T11:00:00Z', 'failure'),
    run('2026-11-01T15:00:00Z', 'success'),
  ], '2026-11-02T00:00:00Z');
  assert.deepEqual(result.fixHours, [6]);
});

test('two separate reds give a median of both, even when the runs arrive out of order', () => {
  const result = timeToFixRedMain([
    run('2026-11-03T10:00:00Z', 'success'),
    run('2026-11-01T09:00:00Z', 'failure'),
    run('2026-11-02T09:00:00Z', 'success'),
    run('2026-11-02T20:00:00Z', 'failure'),
  ], '2026-11-04T00:00:00Z');
  assert.deepEqual(result.fixHours, [24, 14]);
  assert.equal(result.medianHours, 19);
});

test('a red that has not ended is reported as still red and is never dropped (the break: skip the open red)', () => {
  const result = timeToFixRedMain([run('2026-11-01T09:00:00Z', 'success'), run('2026-11-01T10:00:00Z', 'failure')], '2026-11-03T10:00:00Z');
  assert.deepEqual(result.fixHours, []);
  assert.deepEqual(result.stillRed, { since: '2026-11-01T10:00:00Z', hours: 48 });
});

test('a red that began last month and ended this month is counted in this month, not the one it began in (the break: cut the runs to the month first)', () => {
  const runs = [run('2026-10-30T09:00:00Z', 'failure'), run('2026-10-31T09:00:00Z', 'failure'), run('2026-11-02T09:00:00Z', 'success')];
  assert.deepEqual(timeToFixRedMain(runs, '2026-11-30T00:00:00Z', '2026-11').fixHours, [72]);
  const october = timeToFixRedMain(runs, '2026-11-30T00:00:00Z', '2026-10');
  assert.deepEqual(october.fixHours, []);
  assert.equal(october.stillRed, null, 'it ended, so it is not still red');
});

test('a red still open now is not reported in an earlier month it did not begin in', () => {
  const runs = [run('2026-10-05T09:00:00Z', 'success'), run('2026-11-04T09:00:00Z', 'failure')];
  assert.equal(timeToFixRedMain(runs, '2026-11-10T09:00:00Z', '2026-10').stillRed, null);
  assert.equal(timeToFixRedMain(runs, '2026-11-10T09:00:00Z', '2026-11').stillRed?.hours, 144);
});

test('a run that starts red and is cancelled before the next green does not end the red', () => {
  const result = timeToFixRedMain([run('2026-11-01T09:00:00Z', 'failure'), run('2026-11-01T10:00:00Z', 'cancelled'), run('2026-11-01T12:00:00Z', 'success')], '2026-11-02T00:00:00Z');
  assert.deepEqual(result.fixHours, [3]);
});

test('run time is the minutes from the start to the end of the last attempt, with the slowest tenth', () => {
  const runs = [4, 6, 8, 10, 12, 14, 16, 18, 20, 40].map((minutes, i) => run(`2026-11-0${i === 9 ? 9 : i + 1}T10:00:00Z`, 'success', { minutes }));
  const result = runTime(runs);
  assert.equal(result.count, 10);
  assert.equal(result.medianMinutes, 13);
  assert.equal(result.p90Minutes, 22);
});

test('run time counts a run whose end is before its start as zero minutes, never negative', () => {
  const backwards: Run = { id: 99, createdAt: '2026-11-01T10:00:00Z', startedAt: '2026-11-01T10:10:00Z', updatedAt: '2026-11-01T10:00:00Z', attempt: 1, conclusion: 'success', firstAttempt: null };
  assert.equal(runTime([backwards]).medianMinutes, 0);
});
