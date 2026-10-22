// A hung browser install must not cost a job its whole 20 minute timeout. On 2026-10-22
// `playwright install --with-deps` stalled on an Ubuntu mirror inside apt, and the
// ai-test-generator job ran until GitHub cancelled it. Every install step now runs under
// `timeout` and is tried twice, and this test keeps new workflows from skipping that.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WORKFLOWS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');

const installLines = fs.readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((f) => fs.readFileSync(path.join(WORKFLOWS, f), 'utf8').split(/\r?\n/)
    .map((line, i) => ({ where: `${f}:${i + 1}`, line }))
    .filter(({ line }) => line.includes('playwright install')));

test('there are browser install steps to check', () => {
  assert.ok(installLines.length >= 4, `found ${installLines.length}`);
});

test('every browser install runs under timeout, and is tried twice', () => {
  for (const { where, line } of installLines) {
    const tries = line.split('timeout -k').length - 1;
    assert.equal(tries, 2, `${where} must be: timeout -k 10 240 <install> || timeout -k 10 240 <install>`);
  }
});
