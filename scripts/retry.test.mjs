// scripts/retry.sh: a registry that answers 502 now and then must not fail a CI job at once
// (CI run 40954762292, 2026-10-29, Docker Hub). Every image pull in ci.yml goes through it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'retry.sh');
const posix = (p) => p.replace(/\\/g, '/');

// A command that fails its first `failures` times, counting its runs in a file.
function flaky(failures) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-'));
  const counter = posix(path.join(dir, 'count'));
  const script = path.join(dir, 'cmd.sh');
  fs.writeFileSync(script, `#!/usr/bin/env bash\nn=$(( $(cat "${counter}" 2>/dev/null || echo 0) + 1 ))\necho $n > "${counter}"\n[ $n -gt ${failures} ]\n`);
  const run = () => spawnSync('bash', [posix(SCRIPT), 'bash', posix(script)], { env: { ...process.env, RETRY_WAIT: '0' }, encoding: 'utf8' });
  return { run, runs: () => Number(fs.readFileSync(counter, 'utf8')) };
}

test('a command that works runs once', () => {
  const c = flaky(0);
  assert.equal(c.run().status, 0);
  assert.equal(c.runs(), 1);
});

test('a command that fails twice and then works is run 3 times and passes', () => {
  const c = flaky(2);
  assert.equal(c.run().status, 0);
  assert.equal(c.runs(), 3);
});

test('a command that always fails is run 3 times, then fails', () => {
  const c = flaky(99);
  const r = c.run();
  assert.equal(r.status, 1);
  assert.equal(c.runs(), 3);
  assert.match(r.stdout, /Attempt 3 of 3 failed/);
});

test('every image pull in ci.yml goes through retry.sh', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').split(/\r?\n/);
  const pulls = lines.filter((l) => /docker (compose .*)?pull\b/.test(l) && !l.trim().startsWith('#'));
  assert.ok(pulls.length >= 2, `found ${pulls.length} pulls (Langfuse and ZAP)`);
  assert.deepEqual(pulls.filter((l) => !l.includes('scripts/retry.sh')), [], 'prefix the pull with `bash "$GITHUB_WORKSPACE/scripts/retry.sh"`');
});
