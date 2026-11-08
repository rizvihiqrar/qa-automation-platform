import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserNeverConnected, LAUNCH_ATTEMPTS, runWithLaunchRetry, type CypressRun } from '../src/launch-retry.ts';

const neverConnected: CypressRun = { status: 1, output: 'Timed out waiting for the browser to connect. Retrying...\nThe browser never connected. Something is wrong. The tests cannot run. Aborting...' };
const testFailed: CypressRun = { status: 1, output: '  1) a transfer moves money\n     AssertionError: expected 100 to equal 90' };
const passed: CypressRun = { status: 0, output: 'All specs passed!' };

// Hands back the given results in order and counts the runs.
function runner(...results: CypressRun[]) {
  let runs = 0;
  return { run: async () => results[runs++] ?? passed, count: () => runs };
}

test('the log of a browser that never connected is recognised', () => {
  assert.equal(browserNeverConnected(neverConnected.output), true);
});

test('a failing test or a passing run is not taken for a launch failure', () => {
  assert.equal(browserNeverConnected(testFailed.output), false);
  assert.equal(browserNeverConnected(passed.output), false);
});

test('a run that passes is run once', async () => {
  const r = runner(passed);
  assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 0);
  assert.equal(r.count(), 1);
});

test('a browser that never connected is started again, and the second run counts', async () => {
  const r = runner(neverConnected, passed);
  assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 0);
  assert.equal(r.count(), 2);
});

test('a failing test is never run again', async () => {
  const r = runner(testFailed, passed);
  assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 1);
  assert.equal(r.count(), 1);
});

test('a browser that never connects twice fails, after no more than LAUNCH_ATTEMPTS runs', async () => {
  const r = runner(neverConnected, neverConnected, passed);
  assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 1);
  assert.equal(r.count(), LAUNCH_ATTEMPTS);
});

test('a test that fails on the second run still fails the run', async () => {
  const r = runner(neverConnected, testFailed);
  assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 1);
});
