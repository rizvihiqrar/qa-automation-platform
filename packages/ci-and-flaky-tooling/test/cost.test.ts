import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../src/build.ts';
import { billedMinutes, checkTags, costMarkdown, jobKey, mergeQuickJobs, perJob, perKind, prCandidates, staleTags, totals, type RunTimings, type Snapshot } from '../src/cost.ts';

// Two runs, worked out by hand. Billed minutes round each job up: 20 s is 1, 61 s is 2, 120 s is 2, 130 s is 3.
//   main run:  A 20 s (1), B 61 s (2), C 120 s (2), F 5 s (1), D skipped          = 206 s, 6 billed
//   pull run:  A 10 s (1), B 59 s (1), C 130 s (3, failed), F 5 s (1)            = 204 s, 6 billed
const runs: RunTimings[] = [
  { id: 1, event: 'push', createdAt: '2026-11-10T10:00:00Z', jobs: [
    { name: 'A', seconds: 20, conclusion: 'success' }, { name: 'B', seconds: 61, conclusion: 'success' },
    { name: 'C', seconds: 120, conclusion: 'success' }, { name: 'F', seconds: 5, conclusion: 'success' },
    { name: 'D', seconds: 0, conclusion: 'skipped' }] },
  { id: 2, event: 'pull_request', createdAt: '2026-11-11T10:00:00Z', jobs: [
    { name: 'A', seconds: 10, conclusion: 'success' }, { name: 'B', seconds: 59, conclusion: 'success' },
    { name: 'C', seconds: 130, conclusion: 'failure' }, { name: 'F', seconds: 5, conclusion: 'success' },
    { name: 'D', seconds: 0, conclusion: 'skipped' }] },
];
const tags = { A: 'api', B: 'browser', C: 'browser', D: 'tools', F: 'tools' };

test('a job is billed for whole minutes, rounded up, and a job that never ran is billed nothing', () => {
  assert.deepEqual([0, 1, 20, 59, 60, 61, 120, 130].map(billedMinutes), [0, 1, 1, 1, 1, 2, 2, 3]);
});

test('the totals: time run, minutes billed, and the minutes billed that nothing ran in', () => {
  const t = totals(runs);
  assert.equal(t.runs, 2);
  assert.equal(t.jobRuns, 8, 'the two skipped jobs are not counted');
  assert.equal(t.seconds, 410);
  assert.equal(t.billed, 12);
  assert.ok(Math.abs(t.roundedUp - (12 - 410 / 60)) < 1e-9, `rounded-up minutes: ${t.roundedUp}`);
});

test('per job: runs, time, billed minutes, median and slowest 10%, costliest first', () => {
  const jobs = perJob(runs, tags);
  assert.deepEqual(jobs.map((j) => [j.name, j.runs, j.seconds, j.billed]), [['C', 2, 250, 5], ['B', 2, 120, 3], ['A', 2, 30, 2], ['F', 2, 10, 2]]);
  const b = jobs.find((j) => j.name === 'B')!;
  assert.equal(b.medianSeconds, 60, 'the middle of 59 and 61');
  assert.equal(b.p90Seconds, 61);
  assert.equal(jobs.find((j) => j.name === 'D'), undefined, 'a job that only ever skipped has no row');
});

test('per kind adds the jobs up so the kinds make the whole bill', () => {
  const kinds = perKind(perJob(runs, tags));
  assert.deepEqual(kinds.map((k) => [k.kind, k.jobs, k.billed]), [['browser', 2, 8], ['api', 1, 2], ['tools', 1, 2]]);
  assert.equal(kinds.reduce((a, k) => a + k.billed, 0), totals(runs).billed);
});

test('running the quick jobs as one: A and F never passed 30 s; billed apart 4 minutes, together 2', () => {
  const merge = mergeQuickJobs(runs);
  assert.deepEqual(merge.jobs, ['A', 'F']);
  // main run: A 20 + F 5 = 25 s is 1 minute against 1 + 1; pull run: 10 + 5 = 15 s is 1 against 1 + 1
  assert.deepEqual([merge.billedNow, merge.billedMerged, merge.saved], [4, 2, 2]);
  assert.equal(mergeQuickJobs(runs, 5).jobs.length, 0, 'nothing is under 5 s: no saving to claim');
  assert.equal(mergeQuickJobs(runs, 5).saved, 0);
});

test('pull request candidates: only pull request runs count, and a job that failed there is not a candidate', () => {
  const list = prCandidates(runs, tags);
  assert.deepEqual(list.map((c) => [c.name, c.prRuns, c.prBilled, c.failedOnPr]), [['A', 1, 1, 0], ['B', 1, 1, 0], ['F', 1, 1, 0]]);
  assert.ok(!list.some((c) => c.name === 'C'), 'C failed on the pull request run');
  assert.equal(prCandidates(runs, tags, 2).length, 2, 'the list is cut at the number asked for');
});

test('the tags check names a job with no kind and a kind that does not exist; a tag for a job that did not run is only a note', () => {
  const names = ['A', 'B', 'C', 'D', 'F'];
  assert.deepEqual(checkTags(tags, names), []);
  assert.deepEqual(checkTags({ ...tags, A: undefined as unknown as string }, names).length, 1, 'a missing kind');
  const { F: _gone, ...fewer } = tags;
  assert.deepEqual(checkTags(fewer, names), ['job "F" has no kind in data/job-tags.json']);
  assert.match(checkTags({ ...tags, A: 'fast' }, names)[0]!, /"A" is tagged "fast"/);
  assert.deepEqual(checkTags({ ...tags, Z: 'api' }, names), [], 'a tag nothing used is not an error: a job on a rare trigger would turn every refresh red');
  assert.deepEqual(staleTags({ ...tags, Z: 'api' }, names), ['Z']);
  assert.deepEqual(staleTags(tags, names), []);
});

test('the shards of a matrix are one job, so a change in the number of shards changes no name and no tag', () => {
  assert.deepEqual(['regression (shard 1/1)', 'regression (shard 2/3)', 'regression (shard ${{ matrix.shard }}/${{ matrix.total }})', 'zap-baseline'].map(jobKey), ['regression (shards)', 'regression (shards)', 'regression (shards)', 'zap-baseline']);
  const shardRuns: RunTimings[] = [{ id: 1, event: 'push', createdAt: '2026-11-10T10:00:00Z', jobs: [
    { name: 'regression (shard 1/2)', seconds: 70, conclusion: 'success' }, { name: 'regression (shard 2/2)', seconds: 50, conclusion: 'success' }] }];
  const rows = perJob(shardRuns, { 'regression (shards)': 'browser' });
  assert.deepEqual(rows.map((r) => [r.name, r.kind, r.runs, r.seconds, r.billed]), [['regression (shards)', 'browser', 2, 120, 3]]);
  assert.deepEqual(checkTags({ 'regression (shards)': 'browser' }, ['regression (shard 1/2)', 'regression (shard 2/2)']), []);
});

test('a job that timed out on a pull request counts as failed there; one that was cancelled does not', () => {
  const mixed: RunTimings[] = [{ id: 3, event: 'pull_request', createdAt: '2026-11-12T10:00:00Z', jobs: [
    { name: 'slow', seconds: 600, conclusion: 'timed_out' }, { name: 'pushed-over', seconds: 90, conclusion: 'cancelled' }, { name: 'fine', seconds: 30, conclusion: 'success' }] }];
  assert.deepEqual(prCandidates(mixed, {}).map((c) => c.name), ['pushed-over', 'fine']);
});

test('a window with no quick jobs and no pull request runs says so instead of printing empty tables', () => {
  const quiet: Snapshot = { repo: 'o/r', from: '2026-11-10', to: '2026-11-11', runs: [{ id: 1, event: 'push', createdAt: '2026-11-10T10:00:00Z', jobs: [{ name: 'A', seconds: 200, conclusion: 'success' }] }] };
  const page = costMarkdown(quiet, { A: 'api' });
  assert.match(page, /No job stayed under 30 seconds, so there is nothing to merge\./);
  assert.match(page, /0 pull request runs in this window, and no job to move/);
  assert.doesNotMatch(page, /The 0 costliest|jobs never ran longer than 30 seconds \(\)/);
});

test('the page states the totals, the kinds and both savings, with the numbers worked out above', () => {
  const snapshot: Snapshot = { repo: 'o/r', from: '2026-11-10', to: '2026-11-16', runs };
  const page = costMarkdown(snapshot, tags);
  assert.match(page, /The 2 CI runs of o\/r created from 2026-11-10 to 2026-11-16 \(UTC dates; 1 on pull requests, 1 on main/);
  assert.match(page, /\| Time the jobs actually ran \| 6\.8 \|/);
  assert.match(page, /\| Billed \(each job rounded up to a whole minute\) \| 12 \|/);
  assert.match(page, /\| browser \| 2 \| 8 \| 67% \|/);
  assert.match(page, /2 jobs never ran longer than 30 seconds \(A, F\)\. Billed one by one they cost 4 minutes in this window; run as one job per run they would cost 2\. That saves 2 billed minutes \(17% of the bill\)/);
  assert.match(page, /1 pull request runs billed 6 minutes/);
});

// The saved snapshot of the real runs (data/cost-snapshot.json) and the page made from it.
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(packageRoot, file), 'utf8')) as T;
const real = readJson<Snapshot>('data/cost-snapshot.json');
const realTags = readJson<Record<string, string>>('data/job-tags.json');

test('every job in the saved real runs has a kind, and no kind is left over', () => {
  assert.deepEqual(checkTags(realTags, real.runs.flatMap((r) => r.jobs.map((j) => j.name))), []);
});

test('docs/ci-cost.md is exactly what the snapshot and the kinds produce: it cannot drift from the data', () => {
  const page = fs.readFileSync(path.join(packageRoot, 'docs', 'ci-cost.md'), 'utf8').replaceAll(String.fromCharCode(13), '');
  assert.equal(page, costMarkdown(real, realTags), 'run `npm run cost` to rewrite it');
});

test('one real run, counted by hand against the GitHub API when the snapshot was taken: 46 jobs, 1593 s, 56 billed minutes', () => {
  const run = real.runs.find((r) => r.id === 43616500155)!;
  const t = totals([run]);
  assert.deepEqual([run.event, t.jobRuns, t.seconds, t.billed], ['pull_request', 46, 1593, 56]);
});

test('the real totals agree with a plain count, and the kinds and the jobs both add up to them', () => {
  let billed = 0;
  let seconds = 0;
  for (const run of real.runs) for (const job of run.jobs) if (job.conclusion !== 'skipped' && job.seconds > 0) { billed += Math.ceil(job.seconds / 60); seconds += job.seconds; }
  const t = totals(real.runs);
  assert.deepEqual([t.billed, t.seconds], [billed, seconds]);
  const jobs = perJob(real.runs, realTags);
  assert.equal(jobs.reduce((a, j) => a + j.billed, 0), billed);
  assert.equal(perKind(jobs).reduce((a, k) => a + k.billed, 0), billed);
  assert.ok(billed >= seconds / 60, 'rounding up can only add minutes');
});
