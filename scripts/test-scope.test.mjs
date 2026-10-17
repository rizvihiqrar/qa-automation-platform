import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideScope } from './test-scope.mjs';

/** @param {string[] | null} changed @param {string[]} [labels] */
const pr = (changed, labels = []) => decideScope({ event: 'pull_request', pkg: 'bdd-playwright-demo', changed, labels });

test('main, nightly and manual runs get the full suite', () => {
  for (const event of ['push', 'schedule', 'workflow_dispatch']) {
    assert.equal(decideScope({ event, pkg: 'bdd-playwright-demo' }).scope, 'full');
  }
});

test('a pull request that does not touch the suite gets @smoke only', () => {
  const { scope, reason } = pr(['README.md', 'packages/release-gate/src/gate.js']);
  assert.equal(scope, 'smoke');
  assert.match(reason, /full suite runs on main and nightly/);
});

test('a pull request that changes the suite gets the full suite', () => {
  const { scope, reason } = pr(['packages/bdd-playwright-demo/features/login.feature']);
  assert.equal(scope, 'full');
  assert.match(reason, /features\/login\.feature/);
});

test('a package whose name starts the same is not the same package', () => {
  assert.equal(decideScope({ event: 'pull_request', pkg: 'bdd-playwright-demo', changed: ['packages/bdd-playwright-demo-v2/x.ts'] }).scope, 'smoke');
});

test('a pull request that changes how CI runs tests gets the full suite', () => {
  assert.equal(pr(['.github/workflows/ci.yml']).scope, 'full');
  assert.equal(pr(['scripts/test-scope.mjs']).scope, 'full');
  assert.equal(pr(['.github/workflows/dashboard.yml']).scope, 'smoke');
});

test('the full-regression label forces the full suite', () => {
  assert.equal(pr(['README.md'], ['documentation', 'full-regression']).scope, 'full');
});

test('when the changed files cannot be read, run everything', () => {
  const { scope, reason } = pr(null);
  assert.equal(scope, 'full');
  assert.match(reason, /could not read/);
});
