import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fx = (f) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));
const POLICY = fileURLToPath(new URL('../gate.policy.json', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
const tmp = (name, value) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-')), name); fs.writeFileSync(f, JSON.stringify(value)); return f; };

test('parseArgs reads name=path inputs and rejects bad ones', () => {
  const opts = parseArgs(['--policy', 'p.json', '--playwright', 'smoke-tests=a.json', '--k6', 'performance=b.json', '--version', '2.0']);
  assert.equal(opts.inputs.length, 2);
  assert.deepEqual(opts.inputs[0], { adapter: '--playwright', name: 'smoke-tests', file: 'a.json' });
  assert.throws(() => parseArgs(['--k6', 'nopath']), /name=path/);
  assert.throws(() => parseArgs(['--policy', 'p.json']), /at least one result/);
  assert.throws(() => parseArgs(['--bogus', 'x']), /Unknown argument/);
});

test('GO exits 0', () => {
  const contract = tmp('contract.json', { passed: true, summary: '20/20 responses match the spec' });
  const res = run('--policy', POLICY, '--playwright', `smoke-tests=${fx('smoke-playwright.json')}`, '--check', `api-contract=${contract}`, '--k6', `performance=${fx('k6-load.json')}`, '--version', '1.0.0');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Release gate for 1\.0\.0: ✅ GO/);
});

test('NO-GO exits 1, including when a result file is missing', () => {
  const res = run('--policy', POLICY, '--playwright', `smoke-tests=${fx('smoke-playwright.json')}`, '--check', 'api-contract=missing.json', '--k6', `performance=${fx('k6-load.json')}`);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /⛔ NO-GO/);
  assert.match(res.stdout, /api-contract: result file not found: missing\.json/);
});

test('a malformed argument exits 2 with a message', () => {
  const res = run('--k6', 'oops');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /name=path/);
});
