import { test } from 'node:test';
import assert from 'node:assert/strict';
import StopLostRun, { DEFAULTS, LostRunGuard, finalOutcome, parseOptions } from '../src/stop-lost-run.ts';

// Feeds a list of final results ('p' pass, 'f' fail) to a reporter, one test each, and returns the stop messages.
function run(results: string, options?: unknown): string[] {
  const stops: string[] = [];
  const reporter = new StopLostRun(options, (m) => stops.push(m));
  for (const r of results) {
    reporter.onTestEnd({ retries: 0, expectedStatus: 'passed' }, { status: r === 'p' ? 'passed' : 'failed', retry: 0 });
  }
  return stops;
}

test('a clean run never stops', () => {
  assert.deepEqual(run('p'.repeat(200)), []);
});

test('a broken environment stops early, with the numbers and a plain reason', () => {
  const stops = run('f'.repeat(200));
  assert.equal(stops.length, 1);
  assert.match(stops[0]!, /^Stopping the run: 20 of 20 finished tests failed \(100%; the limit is 30% once 20 have finished\)\. The environment looks broken/);
});

test('it stops at the 20th test, not later: the first 19 are never judged', () => {
  assert.deepEqual(run('f'.repeat(19)), []);
  assert.equal(run('f'.repeat(19) + 'f').length, 1);
});

test('a few flaky failures do not trip it: 5 of 20 is under 30%', () => {
  assert.deepEqual(run('p'.repeat(15) + 'f'.repeat(5) + 'p'.repeat(100)), []);
});

test('exactly 30% trips it, and one failure fewer does not', () => {
  assert.equal(run('p'.repeat(14) + 'f'.repeat(6)).length, 1); // 6 of 20
  assert.deepEqual(run('p'.repeat(15) + 'f'.repeat(5)), []); // 5 of 20
});

test('a late collapse still stops the run once the rate passes the limit', () => {
  // 40 passes, then failures: 40 passes + 18 failures is 18 of 58 = 31%.
  const stops = run('p'.repeat(40) + 'f'.repeat(30));
  assert.equal(stops.length, 1);
  assert.match(stops[0]!, /18 of 58 finished tests failed \(31%/);
});

test('it asks to stop once, however many more failures come', () => {
  const guard = new LostRunGuard();
  const messages = Array.from({ length: 50 }, () => guard.record(true)).filter(Boolean);
  assert.equal(messages.length, 1);
});

test('a failure that a retry will redo is not counted, and a pass on the retry counts as a pass', () => {
  const stops: string[] = [];
  const reporter = new StopLostRun({ rate: 0.3, after: 4 }, (m) => stops.push(m));
  const t = { retries: 2, expectedStatus: 'passed' };
  for (let i = 0; i < 6; i += 1) {
    reporter.onTestEnd(t, { status: 'failed', retry: 0 });
    reporter.onTestEnd(t, { status: 'failed', retry: 1 });
    reporter.onTestEnd(t, { status: 'passed', retry: 2 });
  }
  assert.deepEqual(stops, []);
});

test('a test that failed on every try counts once, at the last try', () => {
  assert.equal(finalOutcome({ retries: 2, expectedStatus: 'passed' }, { status: 'failed', retry: 0 }), null);
  assert.equal(finalOutcome({ retries: 2, expectedStatus: 'passed' }, { status: 'timedOut', retry: 1 }), null);
  assert.equal(finalOutcome({ retries: 2, expectedStatus: 'passed' }, { status: 'timedOut', retry: 2 }), 'failed');
});

test('a test cut off by Ctrl-C or a global timeout is not a failure, and a test that timed out on its own is', () => {
  assert.equal(finalOutcome({ retries: 0, expectedStatus: 'passed' }, { status: 'interrupted', retry: 0 }), null);
  assert.equal(finalOutcome({ retries: 0, expectedStatus: 'passed' }, { status: 'timedOut', retry: 0 }), 'failed');
  const stops: string[] = [];
  const reporter = new StopLostRun(undefined, (m) => stops.push(m));
  for (let i = 0; i < 100; i += 1) reporter.onTestEnd({ retries: 0, expectedStatus: 'passed' }, { status: 'interrupted', retry: 0 });
  assert.deepEqual(stops, []);
});

test('skipped tests are not counted, and a test marked as expected to fail counts as a pass when it fails', () => {
  assert.equal(finalOutcome({ retries: 0, expectedStatus: 'passed' }, { status: 'skipped', retry: 0 }), null);
  assert.equal(finalOutcome({ retries: 0, expectedStatus: 'failed' }, { status: 'failed', retry: 0 }), 'passed');
  assert.equal(finalOutcome({ retries: 0, expectedStatus: 'failed' }, { status: 'passed', retry: 0 }), 'failed');
  const stops: string[] = [];
  const reporter = new StopLostRun(undefined, (m) => stops.push(m));
  for (let i = 0; i < 100; i += 1) reporter.onTestEnd({ retries: 0, expectedStatus: 'passed' }, { status: 'skipped', retry: 0 });
  assert.deepEqual(stops, []);
});

test('the options come from the config, with defaults, and a bad value is an error', () => {
  assert.deepEqual(parseOptions(), DEFAULTS);
  assert.deepEqual(parseOptions({ rate: 0.5 }), { rate: 0.5, after: 20 });
  assert.deepEqual(parseOptions({ after: 5 }), { rate: 0.3, after: 5 });
  for (const bad of [{ rate: 0 }, { rate: 1.5 }, { rate: '30%' }, { after: 0 }, { after: 2.5 }]) {
    assert.throws(() => parseOptions(bad), /stop-lost-run:/);
  }
});

test('a stricter rate and an earlier check from the config are used', () => {
  assert.equal(run('f'.repeat(5), { rate: 0.5, after: 5 }).length, 1);
  assert.deepEqual(run('p'.repeat(3) + 'f'.repeat(2), { rate: 0.5, after: 5 }), []); // 2 of 5 is 40%
});
