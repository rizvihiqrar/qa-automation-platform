import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../src/build.ts';
import { revertMergeWithoutParent, walkthrough, type Walkthrough } from '../src/revert.ts';

// RV-xx (A60). One walkthrough, built once: it makes two scratch repositories with git and
// runs a two-test suite about ten times, so it is shared by the tests below.
let w: Walkthrough;
before(() => { w = walkthrough(); });

const suiteOf = (text: string) => w.steps.find((s) => s.step.startsWith(text))?.suite;

test('RV-01 the suite is green, goes red on the bad merge and is green again after the revert', () => {
  assert.equal(suiteOf('The good commit'), 'green');
  assert.equal(suiteOf('A bad change'), 'red');
  assert.equal(suiteOf('The merge is reverted'), 'green');
});

test('RV-02 the revert goes up with an ordinary push, and the bad merge stays in the history under it', () => {
  assert.equal(w.revertPushedWithoutForce, true);
  assert.deepEqual(w.history, [
    'Revert "Merge pull request: tweak total"',
    'Merge pull request: tweak total',
    'Tweak total',
    'Add total and its tests',
  ]);
});

test('RV-03 the teammate who built on the bad merge pulls normally, keeps their commit and has a green suite', () => {
  assert.deepEqual(w.teammate, { pullWorked: true, keepsTheirCommit: true, hasTheRevert: true, suite: 'green' });
});

test('RV-04 after a reset and a force push the history looks clean and the suite is green', () => {
  assert.equal(suiteOf('The other way'), 'green');
});

test('RV-05 after a force push the teammate sees no error, their next push is accepted and the bad merge is back', () => {
  assert.deepEqual(w.forcePush, { teammatePullShowedAnError: false, teammatePushAccepted: true, badChangeReturned: true });
  assert.equal(suiteOf('The teammate pulls (no error'), 'red');
});

test('RV-06 the time from bad merge to green suite leaves out the teammate\'s own work', () => {
  assert.ok(Number.isFinite(w.msBadToGreen) && w.msBadToGreen > 0);
  // A clock that answers 100 (bad push), 200 and 500 (the teammate's work took 300) and 900 (green):
  // 900 - 100 - 300 = 500. Counting the teammate's 300 would give 800.
  const clock = [100, 200, 500, 900];
  const timed = walkthrough({ now: () => clock.shift() ?? 900 });
  assert.equal(timed.msBadToGreen, 500);
});

test('RV-07 the scratch repositories are removed afterwards unless asked to stay', () => {
  assert.equal(fs.existsSync(w.folder), false);
  const kept = walkthrough({ keep: true });
  try {
    assert.equal(fs.existsSync(kept.folder), true);
  } finally {
    fs.rmSync(kept.folder, { recursive: true, force: true });
  }
});

test('RV-08 git refuses to revert a merge without -m, so the page says -m 1', () => {
  assert.match(revertMergeWithoutParent(), /is a merge but no -m option was given/); // git is run with LC_ALL=C, so the wording is fixed
});

test('RV-09 the page gives the commands the script runs and the history it produces', () => {
  const page = fs.readFileSync(path.join(packageRoot, 'docs', 'revert.md'), 'utf8');
  for (const part of ['git revert -m 1', 'git push origin main', 'git push --force origin main', 'git reset --hard']) {
    assert.ok(page.includes(part), `docs/revert.md names "${part}"`);
  }
  for (const line of w.history) assert.ok(page.includes(line), `docs/revert.md shows the history line "${line}"`);
});
