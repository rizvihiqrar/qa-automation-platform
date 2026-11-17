import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAUNCH_ATTEMPTS, LAUNCH_FAILURES, launchFailure, runWithLaunchRetry, type CypressRun } from '../src/launch-retry.ts';

const neverConnected: CypressRun = { status: 1, output: 'Timed out waiting for the browser to connect. Retrying...\nThe browser never connected. Something is wrong. The tests cannot run. Aborting...' };
// The end of CI run 42467489172 (2026-11-08, job attempt 1) without its first lines: the relaunch for the
// second spec crashed in Cypress's own code and the message "never connected" is not in the output.
const relaunchCrash: CypressRun = {
  status: 1,
  output: [
    '  Running:  accounts.cy.ts                                                                  (2 of 5)',
    "Cannot read properties of undefined (reading 'browsingContextGetTree')",
    "TypeError: Cannot read properties of undefined (reading 'browsingContextGetTree')",
    '    at Object.connectToNewSpecBiDi (<embedded>:2755:273024)',
    '    at async E.relaunchBrowser (<embedded>:3005:74147)',
  ].join('\n'),
};
// A spec ran tests and one failed (the Results box of Cypress), then the relaunch for the next spec crashed.
const box = (tests: number, failing: number) => ['  (Results)', '  ┌──────────', `  │ Tests:        ${tests}   │`, `  │ Passing:      ${tests - failing}   │`, `  │ Failing:      ${failing}   │`, '  │ Pending:      0   │'].join('\n');
const failedThenCrash: CypressRun = { status: 1, output: `${box(4, 1)}\n${relaunchCrash.output}` };
// The same crash after a spec that passed: nothing real failed, so it is started again.
const passedThenCrash: CypressRun = { status: 1, output: `${box(4, 0)}\n${relaunchCrash.output}` };
const testFailed: CypressRun = { status: 1, output: '  1) a transfer moves money\n     AssertionError: expected 100 to equal 90' };
const passed: CypressRun = { status: 0, output: 'All specs passed!' };

// Hands back the given results in order and counts the runs.
function runner(...results: CypressRun[]) {
  let runs = 0;
  return { run: async () => results[runs++] ?? passed, count: () => runs };
}

test('the log of a browser that never connected is recognised', () => {
  assert.equal(launchFailure(neverConnected.output), 'The browser never connected');
});

test('the crash when Cypress relaunches the browser for the next spec is recognised, with no "never connected" in it', () => {
  assert.ok(!relaunchCrash.output.includes('never connected'));
  assert.equal(launchFailure(relaunchCrash.output), 'Cypress crashed while relaunching the browser for the next spec');
});

test('a failing test or a passing run is not taken for a launch failure', () => {
  assert.equal(launchFailure(testFailed.output), undefined);
  assert.equal(launchFailure(passed.output), undefined);
  // an ordinary TypeError in a test or the app is not the relaunch crash
  assert.equal(launchFailure("TypeError: Cannot read properties of undefined (reading 'balance')"), undefined);
});

test('a run in which a test failed is never started again, even when the relaunch crashed after it', async () => {
  assert.equal(launchFailure(failedThenCrash.output), undefined);
  const r = runner(failedThenCrash, passed);
  assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 1);
  assert.equal(r.count(), 1);
});

test('the same crash after specs that passed is started again', async () => {
  assert.equal(launchFailure(passedThenCrash.output), 'Cypress crashed while relaunching the browser for the next spec');
  const r = runner(passedThenCrash, passed);
  assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 0);
  assert.equal(r.count(), 2);
});

test('a spec that never started (Tests: 0, Failing: 1) is not a failed test', () => {
  assert.equal(launchFailure(`${box(0, 1)}\n${neverConnected.output}`), 'The browser never connected');
});

test('colour codes in the log do not hide a failed test', () => {
  const esc = String.fromCharCode(27);
  assert.equal(launchFailure(failedThenCrash.output.replace('Failing:      1', `Failing:      ${esc}[31m1${esc}[0m`)), undefined);
});

test('the crash text alone, without a Cypress relaunch frame, is not a launch failure', () => {
  assert.equal(launchFailure("TypeError: Cannot read properties of undefined (reading 'browsingContextGetTree')\n    at app.js:1"), undefined);
});

test('every launch failure in the list has a test run that shows it is started again', async () => {
  const seen: Record<string, CypressRun> = {
    'The browser never connected': neverConnected,
    'Cypress crashed while relaunching the browser for the next spec': relaunchCrash,
  };
  assert.deepEqual(LAUNCH_FAILURES.map((f) => f.name).sort(), Object.keys(seen).sort(), 'add a log excerpt above for every new launch failure');
  for (const [name, failed] of Object.entries(seen)) {
    const r = runner(failed, passed);
    const lines: string[] = [];
    assert.equal((await runWithLaunchRetry(r.run, (line) => lines.push(line))).status, 0, name);
    assert.equal(r.count(), 2, name);
    assert.ok(lines.join('').includes(name), 'the log says which failure it started again for');
  }
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

test('a browser that cannot be started twice fails, after no more than LAUNCH_ATTEMPTS runs', async () => {
  for (const failed of [neverConnected, relaunchCrash]) {
    const r = runner(failed, failed, passed);
    assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 1);
    assert.equal(r.count(), LAUNCH_ATTEMPTS);
  }
});

test('a test that fails on the second run still fails the run', async () => {
  const r = runner(neverConnected, testFailed);
  assert.equal((await runWithLaunchRetry(r.run, () => {})).status, 1);
});
