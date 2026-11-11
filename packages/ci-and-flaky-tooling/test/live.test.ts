import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEscapedIssues, fetchMainRuns, type FetchLike } from '../src/live.ts';

const apiRun = (id: number, extra: object = {}) => ({ id, created_at: '2026-11-01T10:00:00Z', run_started_at: '2026-11-01T10:01:00Z', updated_at: '2026-11-01T10:11:00Z', run_attempt: 1, conclusion: 'success', ...extra });

// A fake GitHub that answers each page from a list and records what it was asked.
function fake(pages: unknown[], status = 200, firstAttempt: string | null = 'failure') {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    urls.push(url);
    headers.push(init.headers);
    if (/\/attempts\/1$/.test(url)) return { ok: status === 200, status, json: async () => ({ conclusion: firstAttempt }) };
    const page = Number(new URL(url).searchParams.get('page'));
    return { ok: status === 200, status, json: async () => pages[page - 1] ?? { workflow_runs: [] } };
  };
  return { fetchImpl, urls, headers };
}

test('runs are read for the month and two weeks either side, on main, finished only, and turned into plain runs', async () => {
  const { fetchImpl, urls } = fake([{ workflow_runs: [apiRun(1)] }]);
  const runs = await fetchMainRuns('2026-02', { repo: 'o/r', fetchImpl });
  assert.deepEqual(runs, [{ id: 1, createdAt: '2026-11-01T10:00:00Z', startedAt: '2026-11-01T10:01:00Z', updatedAt: '2026-11-01T10:11:00Z', attempt: 1, conclusion: 'success', firstAttempt: null }]);
  const url = new URL(urls[0]!);
  assert.equal(url.pathname, '/repos/o/r/actions/workflows/ci.yml/runs');
  assert.equal(url.searchParams.get('branch'), 'main');
  assert.equal(url.searchParams.get('status'), 'completed');
  assert.equal(url.searchParams.get('created'), '2026-01-18..2026-03-14', 'two weeks before the 1st and after the real last day');
});

test('a green run that was re-run gets its first attempt read, and only that run does', async () => {
  const pages = [{ workflow_runs: [apiRun(1, { run_attempt: 2 }), apiRun(2), apiRun(3, { run_attempt: 2, conclusion: 'failure' })] }];
  const failed = await fetchMainRuns('2026-11', { repo: 'o/r', fetchImpl: fake(pages, 200, 'failure').fetchImpl });
  assert.deepEqual(failed.map((r) => r.firstAttempt), ['failure', null, null]);
  const passed = await fetchMainRuns('2026-11', { repo: 'o/r', fetchImpl: fake(pages, 200, 'success').fetchImpl });
  assert.equal(passed[0]!.firstAttempt, 'success');
});

test('a run with no attempt or start time still reads, as a first attempt starting when it was created', async () => {
  const { fetchImpl } = fake([{ workflow_runs: [{ id: 2, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:05:00Z', conclusion: 'failure' }] }]);
  const [run] = await fetchMainRuns('2026-11', { repo: 'o/r', fetchImpl });
  assert.equal(run!.attempt, 1);
  assert.equal(run!.startedAt, run!.createdAt);
});

test('more runs than one page are read page by page until a short page', async () => {
  const full = { workflow_runs: Array.from({ length: 100 }, (_, i) => apiRun(i)) };
  const { fetchImpl, urls } = fake([full, { workflow_runs: [apiRun(100)] }]);
  const runs = await fetchMainRuns('2026-11', { repo: 'o/r', fetchImpl });
  assert.equal(runs.length, 101);
  assert.equal(urls.length, 2);
});

test('a month with more runs than the page limit is an error, not a quietly partial month (the break: stop without saying)', async () => {
  const full = { workflow_runs: Array.from({ length: 100 }, (_, i) => apiRun(i)) };
  const { fetchImpl, urls } = fake(Array.from({ length: 50 }, () => full));
  await assert.rejects(fetchMainRuns('2026-11', { repo: 'o/r', fetchImpl }), /more than 1000 items/);
  assert.equal(urls.length, 10);
});

test('an error from GitHub is an error, not an empty month', async () => {
  const { fetchImpl } = fake([], 403);
  await assert.rejects(fetchMainRuns('2026-11', { repo: 'o/r', fetchImpl }), /GitHub answered 403/);
});

test('the token is sent when there is one and left out when there is not', async () => {
  const withToken = fake([{ workflow_runs: [] }]);
  await fetchMainRuns('2026-11', { repo: 'o/r', token: 'abc', fetchImpl: withToken.fetchImpl });
  assert.equal(withToken.headers[0]!.Authorization, 'Bearer abc');
  const without = fake([{ workflow_runs: [] }]);
  await fetchMainRuns('2026-11', { repo: 'o/r', fetchImpl: without.fetchImpl });
  assert.equal(without.headers[0]!.Authorization, undefined);
});

test('escaped-bug issues come from the label, open and closed, and pull requests are skipped', async () => {
  const issue = (number: number, extra: object = {}) => ({ number, title: `t${number}`, body: '', created_at: '2026-11-01T00:00:00Z', html_url: `u${number}`, ...extra });
  const { fetchImpl, urls } = fake([[issue(1), issue(2, { pull_request: {} }), issue(3)]]);
  const issues = await fetchEscapedIssues({ repo: 'o/r', fetchImpl });
  assert.deepEqual(issues.map((i) => i.number), [1, 3]);
  const url = new URL(urls[0]!);
  assert.equal(url.searchParams.get('labels'), 'escaped-bug');
  assert.equal(url.searchParams.get('state'), 'all');
});
