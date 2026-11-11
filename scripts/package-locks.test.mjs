// Every package with a package.json needs a package-lock.json beside it. CI runs `npm ci` in each
// package (the type-check job and the test jobs), and `npm ci` stops without a lockfile. A new
// package with no dependencies hid this: it type-checked and tested fine on a machine that
// already had it set up, and failed only in CI (found 2026-11-11, S4's pull request).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = path.join(ROOT, 'packages');

// Folders under packages/ that have a package.json, with whether a lockfile sits next to it.
export function lockStatus(packagesDir) {
  return fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(packagesDir, e.name, 'package.json')))
    .map((e) => ({ name: e.name, hasLock: fs.existsSync(path.join(packagesDir, e.name, 'package-lock.json')) }));
}

test('every package with a package.json has a package-lock.json (the break: add a package, forget npm install)', () => {
  const missing = lockStatus(PACKAGES).filter((p) => !p.hasLock).map((p) => p.name);
  assert.deepEqual(missing, [], `no package-lock.json in: ${missing.join(', ')}. Run: npm install --package-lock-only`);
});

test('the check sees a package that has no lockfile', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'locks-'));
  try {
    fs.mkdirSync(path.join(dir, 'with'));
    fs.mkdirSync(path.join(dir, 'without'));
    fs.mkdirSync(path.join(dir, 'no-package-json'));
    for (const name of ['with', 'without']) fs.writeFileSync(path.join(dir, name, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'with', 'package-lock.json'), '{}');
    assert.deepEqual(lockStatus(dir), [{ name: 'with', hasLock: true }, { name: 'without', hasLock: false }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
