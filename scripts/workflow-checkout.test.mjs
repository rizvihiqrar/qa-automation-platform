// A job that runs a script from this repo needs actions/checkout first. The CI recheck job called
// scripts/retry.sh without one and failed with exit code 127 (run 41815568128, 2026-11-04), so a
// failed Monitor run was never re-run. This test reads every workflow and fails when a job uses
// $GITHUB_WORKSPACE/scripts/ or a repo path without checking the repo out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

// Splits a workflow into its jobs: a job starts at a two-space key under `jobs:`.
export function jobsOf(yaml) {
  const lines = yaml.split(/\r?\n/).filter((l) => !l.trim().startsWith('#'));
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const jobs = [];
  for (const line of lines.slice(start + 1)) {
    const key = line.match(/^ {2}([\w-]+):\s*$/);
    if (key) jobs.push({ name: key[1], text: '' });
    else if (jobs.length) jobs.at(-1).text += `${line}\n`;
  }
  return jobs;
}

export const usesRepoScript = (text) => /\$\{?GITHUB_WORKSPACE\}?\/|(^|\s)(node|bash|sh)( -\w+)* (\.\/)?scripts\/|(^|\s)\.\/scripts\/|uses:\s*\.\//.test(text);
// A `- uses:` step key at the start of a line: not a comment, not text inside a run block's echo.
export const checksOutRepo = (text) => /^\s*- uses:\s*actions\/checkout@/m.test(text);

test('every job that runs a repo script checks the repo out first', () => {
  const missing = [];
  for (const file of fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const jobs = jobsOf(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8'));
    assert.ok(jobs.length > 0, `${file}: no jobs found, so the check would pass without looking`);
    for (const job of jobs) {
      if (usesRepoScript(job.text) && !checksOutRepo(job.text)) missing.push(`${file}: ${job.name}`);
    }
  }
  assert.deepEqual(missing, [], 'add `- uses: actions/checkout@v4` as the first step of these jobs');
});

test('the check finds the 2026-11-04 mistake: a job with retry.sh and no checkout', () => {
  const bad = 'jobs:\n  rerun:\n    steps:\n      - run: bash "$GITHUB_WORKSPACE/scripts/retry.sh" gh run rerun 1\n';
  const [job] = jobsOf(bad);
  assert.ok(usesRepoScript(job.text) && !checksOutRepo(job.text));
  const good = bad.replace('steps:\n', 'steps:\n      - uses: actions/checkout@v4\n');
  assert.ok(checksOutRepo(jobsOf(good)[0].text));
});

test('comments do not count as a checkout', () => {
  const commented = 'jobs:\n  a:\n    steps:\n      # - uses: actions/checkout@v4\n      - run: node scripts/x.mjs\n';
  const [job] = jobsOf(commented);
  assert.ok(usesRepoScript(job.text) && !checksOutRepo(job.text));
});

test('other ways of using a repo script are caught, and a checkout in a comment or string is not one', () => {
  for (const run of ['./scripts/x.sh', 'bash -e scripts/x.sh', 'echo ${GITHUB_WORKSPACE}/scripts/x']) {
    assert.ok(usesRepoScript(`      - run: ${run}\n`), run);
  }
  assert.ok(usesRepoScript('      - uses: ./.github/actions/foo\n'));
  assert.ok(!checksOutRepo('      - run: echo hi # uses: actions/checkout@v4\n'));
});
