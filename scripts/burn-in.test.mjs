import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CYPRESS, CYPRESS_BROWSERS, PLAYWRIGHT, REPEATS, commands, plan } from './burn-in.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a changed Playwright spec runs 3 times through its own config, with no retries', () => {
  const [g] = plan(['packages/multi-user-flow-patterns/tests/cart.spec.ts']);
  assert.deepEqual([g.runner, g.pkg, g.config, g.files], ['playwright', 'multi-user-flow-patterns', 'playwright.config.ts', ['tests/cart.spec.ts']]);
  const [[, cmd, args]] = commands(g);
  assert.equal(cmd, 'npx');
  assert.ok(args.includes('--repeat-each=3') && args.includes('--retries=0'));
  assert.deepEqual(args.slice(-1), ['tests/cart.spec.ts']);
});

test('specs are grouped by the config that runs them', () => {
  const groups = plan([
    'packages/ai-test-generator/tests/regression/cart.spec.js',
    'packages/ai-test-generator/tests/regression/login.spec.js',
    'packages/ai-test-generator/tests/review/session.spec.js',
    'packages/ai-test-generator/examples/output/x.spec.js',
  ]);
  assert.deepEqual(groups.map((g) => [g.config, g.files.length]), [
    ['playwright.regression.config.js', 2],
    ['playwright.review.config.js', 1],
    ['playwright.config.js', 1],
  ]);
});

test('a changed Cypress spec runs 3 times in each browser, each run numbered', () => {
  const [g] = plan(['packages/banking-api/cypress/e2e/tabs.cy.ts', 'packages/banking-api/cypress/e2e/money.cy.ts']);
  assert.equal(g.runner, 'cypress');
  const runs = commands(g);
  assert.equal(runs.length, REPEATS * CYPRESS_BROWSERS.length);
  assert.deepEqual(runs[0][2], ['src/ui-test.ts', '--browser', 'chrome', '--spec', 'cypress/e2e/tabs.cy.ts,cypress/e2e/money.cy.ts', '--expose', 'BURN_IN_RUN=1']);
  assert.match(runs.at(-1)[0], /firefox run 3\/3/);
});

test('helpers, unit tests outside the browser suites, docs and other repos are not burned in', () => {
  assert.deepEqual(plan([
    'packages/ai-test-generator/tests/review/helpers.js',
    'packages/ai-test-generator/test/review.test.js', // node:test, not Playwright
    'packages/banking-api/test/api.test.ts',
    'packages/banking-api/cypress/support/e2e.ts',
    'packages/multi-user-flow-patterns/README.md',
    'scripts/burn-in.mjs',
  ]), []);
});

test('Windows paths are accepted', () => {
  assert.equal(plan(['packages\\llm-judge-check\\evidence\\label-evidence.spec.ts'])[0].config, 'playwright.config.ts');
});

test('every Playwright config in the repo is in the burn-in table', () => {
  const inRepo = fs.readdirSync(path.join(ROOT, 'packages')).flatMap((pkg) => {
    const dir = path.join(ROOT, 'packages', pkg);
    if (!fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir).filter((f) => /^playwright(\..+)?\.config\.(js|ts|mjs)$/.test(f)).map((f) => `${pkg}/${f}`);
  });
  const listed = PLAYWRIGHT.map((s) => `${s.pkg}/${s.config}`);
  assert.deepEqual(inRepo.filter((c) => !listed.includes(c)), [], 'add these to PLAYWRIGHT in scripts/burn-in.mjs');
  for (const s of [...PLAYWRIGHT, ...CYPRESS]) {
    for (const d of s.dirs) assert.ok(fs.existsSync(path.join(ROOT, 'packages', s.pkg, d)) || d === 'tests/generated/', `${s.pkg}/${d}`);
  }
});
