// Only Linux baselines are committed for packages/visual-regression-demo: they are the pictures CI compares
// with. A baseline made on Windows or macOS is for local runs only and the package's .gitignore keeps it out.
// On 2026-10-26 a branch made while the folder was still untracked committed 32 Windows pictures by accident.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'packages/visual-regression-demo';

test('every committed baseline is a Linux one, and the other systems are ignored', () => {
  const tracked = execFileSync('git', ['ls-files', `${PKG}/baselines`], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.length > 0, 'the Linux baselines are committed');
  const stray = tracked.filter((f) => !f.startsWith(`${PKG}/baselines/linux/`));
  assert.deepEqual(stray, [], 'baselines for another system are tracked: git rm --cached them');
  const ignore = fs.readFileSync(path.join(ROOT, PKG, '.gitignore'), 'utf8');
  assert.match(ignore, /^baselines\/win32\/$/m);
  assert.match(ignore, /^baselines\/darwin\/$/m);
});

test('each browser has the same set of Linux baselines', () => {
  const names = (browser) => fs.readdirSync(path.join(ROOT, PKG, 'baselines/linux', browser)).sort();
  assert.deepEqual(names('firefox'), names('chromium'));
  assert.equal(names('chromium').length, 16);
});
