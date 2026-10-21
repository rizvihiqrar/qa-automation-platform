// A test that fails and then passes on a retry must fail the CI job, not hide behind
// the retry (ai-test-generator RV-17 passed on retry 3 times before anyone looked).
// For every Playwright config in the repo, this runs a deliberately flaky test through
// that config's own settings with CI set, and expects a red exit; without CI, green.
// Needs each package's dependencies installed (CI: npm run typecheck -- --install).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function playwrightConfigs() {
  return fs.readdirSync(path.join(ROOT, 'packages')).flatMap((pkg) => {
    const dir = path.join(ROOT, 'packages', pkg);
    if (!fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir).filter((f) => /^playwright(\..+)?\.config\.(js|ts|mjs)$/.test(f)).map((f) => ({ pkg, file: f }));
  });
}

const FLAKY = `import { expect, test } from '@playwright/test';
test('fails on the first try, passes on the retry', ({}, info) => {
  expect(info.retry).toBe(1);
});
`;

// The package's real config, with only what the proof needs swapped out: the fixture
// as the only test, one project (no browser is launched), one retry, and no server or
// setup. failOnFlakyTests is what's left to decide the exit code.
function proofConfig(file) {
  return `import base from '../${file}';
export default { ...base, testDir: '.', testMatch: 'flaky.spec.ts', testIgnore: [], projects: [{ name: 'proof' }], retries: 1,
  reporter: 'line', webServer: undefined, globalSetup: undefined, globalTeardown: undefined };
`;
}

function runFlaky(pkg, file, ci) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'packages', pkg, '.flaky-proof-'));
  try {
    fs.writeFileSync(path.join(dir, 'flaky.spec.ts'), FLAKY);
    fs.writeFileSync(path.join(dir, 'proof.config.ts'), proofConfig(file));
    const cli = path.join(ROOT, 'packages', pkg, 'node_modules', '@playwright', 'test', 'cli.js');
    return spawnSync(process.execPath, [cli, 'test', '-c', path.join(dir, 'proof.config.ts')], {
      cwd: path.join(ROOT, 'packages', pkg),
      env: { ...process.env, CI: ci ? 'true' : '' },
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('every Playwright config is found', () => {
  assert.ok(playwrightConfigs().length >= 9);
});

for (const { pkg, file } of playwrightConfigs()) {
  test(`${pkg}/${file}: a pass on retry fails the job in CI`, () => {
    const ci = runFlaky(pkg, file, true);
    assert.match(ci.stdout, /1 flaky/, ci.stdout + ci.stderr);
    assert.equal(ci.status, 1, 'flaky test did not fail the run');
    const local = runFlaky(pkg, file, false);
    assert.match(local.stdout, /1 flaky/, local.stdout + local.stderr);
    assert.equal(local.status, 0, 'outside CI a flaky test is reported, not failed');
  });
}
