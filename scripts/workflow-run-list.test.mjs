// A workflow must not rely on GitHub to filter `gh run list`. On 2026-10-22, during a
// GitHub incident with errors loading search results, `--branch main --status completed`
// returned an empty list while the unfiltered list was fine. The Flaky tests workflow then
// found 0 runs to analyze and failed on main. The workflows now list unfiltered and select
// the runs themselves, and this test keeps the filters from coming back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WORKFLOWS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const JQ_FLAKY = '.[] | select(.headBranch == "main" and .status == "completed") | .databaseId';

const listCalls = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).flatMap((f) =>
  fs.readFileSync(path.join(WORKFLOWS, f), 'utf8').split(/\r?\n/)
    .map((line, i) => ({ where: `${f}:${i + 1}`, line }))
    .filter(({ line }) => line.includes('gh run list')));

test('there are gh run list calls to check', () => {
  assert.ok(listCalls.length >= 2, `found ${listCalls.length}`);
});

test('no gh run list call asks GitHub to filter by branch or status', () => {
  const filtered = listCalls.filter(({ line }) => /--(branch|status|user|event|commit)\b/.test(line));
  assert.deepEqual(filtered.map((c) => c.where), [], 'list unfiltered and select the runs with jq');
});

test('flaky.yml selects with the expression tested below', () => {
  assert.ok(fs.readFileSync(path.join(WORKFLOWS, 'flaky.yml'), 'utf8').includes(JQ_FLAKY));
});

test('the jq selection keeps completed runs on main and nothing else', () => {
  // Skipped where jq is not installed (it is on GitHub runners).
  let jq;
  try { jq = (input, expr) => execFileSync('jq', ['-r', expr], { input, encoding: 'utf8' }).trim(); jq('[]', '.'); } catch { return; }
  const runs = JSON.stringify([
    { databaseId: 1, headBranch: 'main', status: 'completed' },
    { databaseId: 2, headBranch: 'feature', status: 'completed' },
    { databaseId: 3, headBranch: 'main', status: 'in_progress' },
    { databaseId: 4, headBranch: 'main', status: 'completed' },
  ]);
  assert.equal(jq(runs, JQ_FLAKY), '1\n4');
});
