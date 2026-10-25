// Every package's Playwright config must keep the evidence a flaky failure needs and must
// not hide one. A trace kept on failure shows what the page or API did before a test failed;
// without it a flake that happens once in CI can only be guessed at. failOnFlakyTests turns
// a pass-on-retry into a red job, so retries cannot hide a flake. A new package that copies
// an old config gets both for free; one that writes its own config fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = path.join(ROOT, 'packages');
const configs = fs.readdirSync(PACKAGES)
  .flatMap((pkg) => fs.readdirSync(path.join(PACKAGES, pkg)).filter((f) => /^playwright\.config\.[cm]?[jt]s$/.test(f)).map((f) => `${pkg}/${f}`));
const read = (rel) => fs.readFileSync(path.join(PACKAGES, rel), 'utf8');

test('the repo has Playwright configs to check', () => {
  assert.ok(configs.length >= 8, `found ${configs.length} configs`);
});

test('every Playwright config keeps a trace on failure', () => {
  const missing = configs.filter((c) => !/trace:\s*'retain-on-failure'/.test(read(c)));
  assert.deepEqual(missing, [], "add trace: 'retain-on-failure' to use: { ... }");
});

test('every Playwright config fails the job on a test that passes only on a retry', () => {
  const missing = configs.filter((c) => !/failOnFlakyTests:\s*!!process\.env\.CI/.test(read(c)));
  assert.deepEqual(missing, [], 'add failOnFlakyTests: !!process.env.CI');
});

test('the CI job uploads the traces, not only the HTML report', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(ci.includes('packages/${{ matrix.package }}/test-results/'), 'upload packages/<pkg>/test-results/ with the reports');
});
