// The guard in scripts/require-scenarios.ts is what stops a mistyped tag from
// giving a green run that tested nothing (cucumber-js --tags exits 0 when no
// scenario matches). These tests prove the guard itself fails when it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const guard = (...args: string[]) =>
  spawnSync(process.execPath, ['scripts/require-scenarios.ts', ...args], { encoding: 'utf8' });

test('a tag that selects scenarios passes and says how many', () => {
  const r = guard('@smoke');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 scenario\(s\) match "@smoke"/);
});

test('a mistyped tag fails instead of running nothing', () => {
  const r = guard('@smok');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No scenarios match the tags "@smok"/);
});

test('a tag expression that excludes everything fails too', () => {
  const r = guard('@smoke and not @smoke');
  assert.equal(r.status, 1);
});

test('no tag at all is a usage error', () => {
  const r = guard();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});
