import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCostSnapshot, jobSeconds, retried } from '../src/live-cost.ts';
import type { FetchLike } from '../src/live.ts';

test('a job lasts from its start to its end in whole seconds; one that never started or finished lasts 0', () => {
  assert.equal(jobSeconds('2026-11-10T10:00:00Z', '2026-11-10T10:01:05Z'), 65);
  assert.equal(jobSeconds('2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z'), 0);
  assert.equal(jobSeconds(null, '2026-11-10T10:00:00Z'), 0, 'skipped jobs have no start');
  assert.equal(jobSeconds('2026-11-10T10:00:00Z', null), 0);
  assert.equal(jobSeconds('2026-11-10T10:05:00Z', '2026-11-10T10:00:00Z'), 0, 'an end before the start is not a negative time');
});

// A fake GitHub: one page of runs, then each run's jobs, recording what it was asked.
function fake(status = 200) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const u = new URL(url);
    if (/\/workflows\/ci\.yml\/runs$/.test(u.pathname)) {
      return { ok: status === 200, status, json: async () => ({ workflow_runs: [
        { id: 20, event: 'pull_request', created_at: '2026-11-11T10:00:00Z', conclusion: 'success' },
        { id: 10, event: 'push', created_at: '2026-11-10T10:00:00Z', conclusion: 'success' },
      ] }) };
    }
    return { ok: status === 200, status, json: async () => ({ jobs: [
      { name: 'A', conclusion: 'success', started_at: '2026-11-10T10:00:00Z', completed_at: '2026-11-10T10:00:42Z' },
      { name: 'B', conclusion: 'skipped', started_at: null, completed_at: null },
    ] }) };
  };
  return { fetchImpl, urls };
}

test('the last N days of CI runs on every event are read with the jobs of every attempt, oldest first', async () => {
  const { fetchImpl, urls } = fake();
  const snapshot = await fetchCostSnapshot(14, new Date('2026-11-16T12:00:00Z'), { repo: 'o/r', fetchImpl });
  const first = new URL(urls[0]!);
  assert.equal(first.pathname, '/repos/o/r/actions/workflows/ci.yml/runs');
  assert.equal(first.searchParams.get('created'), '2026-11-02..2026-11-16');
  assert.equal(first.searchParams.get('status'), 'completed');
  assert.equal(first.searchParams.get('branch'), null, 'every branch: pull request runs are the point');
  assert.ok(urls.some((u) => u.includes('/runs/10/jobs?filter=all')) && urls.some((u) => u.includes('/runs/20/jobs?filter=all')), 'every attempt of a re-run is billed, so every attempt is read');
  assert.deepEqual(snapshot.runs.map((r) => [r.id, r.event]), [[10, 'push'], [20, 'pull_request']]);
  assert.deepEqual(snapshot.runs[0]!.jobs, [{ name: 'A', seconds: 42, conclusion: 'success' }, { name: 'B', seconds: 0, conclusion: 'skipped' }]);
  assert.deepEqual([snapshot.repo, snapshot.from, snapshot.to], ['o/r', '2026-11-02', '2026-11-16']);
});

test('a failed answer from GitHub stops the read with the status, instead of a smaller snapshot', async () => {
  await assert.rejects(fetchCostSnapshot(7, new Date('2026-11-16T12:00:00Z'), { repo: 'o/r', fetchImpl: fake(403).fetchImpl }), /GitHub answered 403/);
});

test('a busy GitHub (5xx) is tried again up to three times, and any other error stops at once', async () => {
  let calls = 0;
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  const flaky = async () => { calls++; if (calls < 3) throw new Error('GitHub answered 502 for x'); return 'ok'; };
  assert.equal(await retried(flaky, wait), 'ok');
  assert.deepEqual([calls, waits], [3, [500, 1000]]);

  calls = 0;
  await assert.rejects(retried(async () => { calls++; throw new Error('GitHub answered 502 for x'); }, wait), /502/);
  assert.equal(calls, 3, 'gives up after three tries');

  calls = 0;
  await assert.rejects(retried(async () => { calls++; throw new Error('GitHub answered 403 for x'); }, wait), /403/);
  assert.equal(calls, 1, 'a 403 is not retried');
});
