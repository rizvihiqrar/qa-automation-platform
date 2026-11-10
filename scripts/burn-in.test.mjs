import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CYPRESS, CYPRESS_BROWSERS, PLAYWRIGHT, REPEATS, collectorImages, commands, plan } from './burn-in.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a changed Playwright spec runs 3 times through its own config, with no retries', () => {
  const [g] = plan(['packages/multi-user-flow-patterns/tests/cart.spec.ts']);
  assert.deepEqual([g.runner, g.pkg, g.config, g.files], ['playwright', 'multi-user-flow-patterns', 'playwright.config.ts', ['tests/cart.spec.ts']]);
  const [[, cmd, args]] = commands(g);
  assert.equal(cmd, 'npx');
  assert.ok(args.includes('--repeat-each=3') && args.includes('--retries=0'));
  assert.deepEqual(args.slice(-1), ['tests/cart.spec.ts']);
});

// The PR that added tests/postgres would have failed burn-in: the plain run skips
// that folder (no DATABASE_URL), so Playwright found no tests (code review, Day 49).
test('qa-practice-api Postgres specs run inside Testcontainers; the race tests run on both stores', () => {
  const groups = plan([
    'packages/qa-practice-api/tests/postgres/postgres.spec.ts',
    'packages/qa-practice-api/tests/concurrency.spec.ts',
    'packages/qa-practice-api/tests/orders.spec.ts',
  ]);
  assert.deepEqual(groups.map((g) => [g.key, g.files]), [
    ['qa-practice-api/playwright.config.ts on Postgres', ['tests/postgres/postgres.spec.ts', 'tests/concurrency.spec.ts']],
    ['qa-practice-api/playwright.config.ts', ['tests/concurrency.spec.ts', 'tests/orders.spec.ts']],
  ]);
  const [pull, pullProxy, run] = commands(groups[0]);
  assert.deepEqual(pull[2].slice(1), ['docker', 'pull', '--quiet', 'postgres:17-alpine']);
  assert.deepEqual(pullProxy[2].slice(1), ['docker', 'pull', '--quiet', 'ghcr.io/shopify/toxiproxy:2.12.0']);
  assert.match(pull[2][0], /retry\.sh$/);
  assert.deepEqual([run[1], run[2].slice(0, 2)], ['node', ['scripts/with-postgres.ts', 'npx']]);
  assert.ok(run[2].includes('--repeat-each=3') && run[2].includes('--retries=0'));
  assert.equal(run[3].TESTCONTAINERS_RYUK_DISABLED, 'true');
});

// Same trap as tests/postgres: without COLLECTOR_URL the plain run skips tests/collector,
// so a PR that changed one would find no tests.
test('qa-practice-api Collector specs run inside Docker, never in the plain group', () => {
  const groups = plan(['packages/qa-practice-api/tests/collector/pipeline.spec.ts']);
  assert.deepEqual(groups.map((g) => [g.key, g.files]), [
    ['qa-practice-api/playwright.config.ts on the Collector', ['tests/collector/pipeline.spec.ts']],
  ]);
  const steps = commands(groups[0]);
  assert.deepEqual(steps.slice(0, -1).map(([, , args]) => args.slice(1)),
    collectorImages().map((image) => ['docker', 'pull', '--quiet', image]));
  const run = steps.at(-1);
  assert.deepEqual([run[1], run[2].slice(0, 2)], ['node', ['scripts/with-collector.ts', 'npx']]);
  assert.ok(run[2].includes('--repeat-each=3') && run[2].includes('--retries=0'));
  assert.equal(run[3].TESTCONTAINERS_RYUK_DISABLED, 'true');
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
