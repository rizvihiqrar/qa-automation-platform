// Only Linux baselines are committed for packages/visual-regression-demo: they are the pictures CI compares
// with. A baseline made on Windows or macOS is for local runs only and the package's .gitignore keeps it out.
// On 2026-10-26 a branch made while the folder was still untracked committed 32 Windows pictures by accident.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'packages/visual-regression-demo';

const tracked = () => execFileSync('git', ['ls-files', `${PKG}/baselines`], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

test('every committed baseline is a Linux one', () => {
  assert.ok(tracked().length > 0, 'the Linux baselines are committed');
  const stray = tracked().filter((f) => !f.startsWith(`${PKG}/baselines/linux/`));
  assert.deepEqual(stray, [], 'baselines for another system are tracked: git rm --cached them');
});

test('git ignores a baseline made on Windows or macOS', () => {
  for (const system of ['win32', 'darwin']) {
    const sample = `${PKG}/baselines/${system}/chromium/sample.png`;
    assert.doesNotThrow(() => execFileSync('git', ['check-ignore', '-q', sample], { cwd: ROOT }), `${sample} is not ignored`);
  }
});

test('each browser has the same Linux baselines', () => {
  const byBrowser = (browser) => tracked().filter((f) => f.includes(`/baselines/linux/${browser}/`)).map((f) => path.basename(f)).sort();
  assert.ok(byBrowser('chromium').length > 0);
  assert.deepEqual(byBrowser('firefox'), byBrowser('chromium'));
});
