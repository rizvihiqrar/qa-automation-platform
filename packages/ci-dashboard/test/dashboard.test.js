import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, quantile } from '../src/metrics.js';
import { normalizeRun, fetchRuns } from '../src/github.js';
import { renderHtml, esc, niceMax, statusOf } from '../src/render.js';

const job = (name, conclusion, seconds = 10, attempt = 1) => ({ name, conclusion, seconds, attempt });
const run = (number, sha, conclusion, jobs, seconds = 60) => ({
  id: number, number, event: 'push', branch: 'main', sha, conclusion, seconds,
  createdAt: `2026-10-${String(10 + number).padStart(2, '0')}T08:00:00Z`, jobs,
});

const runs = [
  run(1, 'aaa', 'success', [job('api', 'success', 10), job('ui', 'success', 40)], 60),
  // ui failed on its first attempt and passed on a re-run: flaky on re-run.
  run(2, 'bbb', 'success', [job('api', 'success', 12), job('ui', 'failure', 41, 1), job('ui', 'success', 39, 2)], 120),
  // api failed on commit ccc ...
  run(3, 'ccc', 'failure', [job('api', 'failure', 11), job('ui', 'success', 42), job('lint', 'cancelled', 1)], 90),
  // ... and passed on a later run of the same commit: flaky on the same commit.
  run(4, 'ccc', 'success', [job('api', 'success', 13), job('ui', 'success', 38)], 75),
];

test('quantile uses nearest rank and ignores missing values', () => {
  assert.equal(quantile([3, 1, 2, null, 4], 0.5), 2);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(quantile([], 0.5), null);
});

test('per-package pass rate counts only the last attempt and ignores cancelled jobs', () => {
  const { packages } = computeMetrics(runs);
  const api = packages.find((p) => p.name === 'api');
  const ui = packages.find((p) => p.name === 'ui');
  assert.deepEqual([api.results, api.passRate, api.lastFailure], [4, 75, '2026-10-13T08:00:00Z']);
  assert.deepEqual([ui.results, ui.passRate], [4, 100]);
  assert.equal(packages.find((p) => p.name === 'lint'), undefined);
});

test('flaky jobs are found both on re-run and on the same commit', () => {
  const { packages, overall } = computeMetrics(runs);
  assert.equal(packages.find((p) => p.name === 'ui').flaky, 1);
  assert.equal(packages.find((p) => p.name === 'api').flaky, 1);
  assert.equal(overall.flakyJobs, 2);
});

test('durations: median and p90 per package', () => {
  const ui = computeMetrics(runs).packages.find((p) => p.name === 'ui');
  assert.equal(ui.medianSeconds, 39);
  assert.equal(ui.p90Seconds, 42);
});

test('a feature branch failure counts for nothing but flakiness', () => {
  const onBranch = (r) => ({ ...r, branch: 'feature', event: 'pull_request' });
  const mixed = [
    ...runs,
    // A change still in progress fails ui on a branch ...
    onBranch(run(5, 'ddd', 'failure', [job('api', 'success', 10), job('ui', 'failure', 40)])),
    // ... and a branch run that failed, then passed on a re-run, is flaky like on main.
    onBranch(run(6, 'eee', 'success', [job('api', 'failure', 10, 1), job('api', 'success', 11, 2)])),
  ];
  const { packages, overall, trend } = computeMetrics(mixed);
  const ui = packages.find((p) => p.name === 'ui');
  const api = packages.find((p) => p.name === 'api');
  assert.deepEqual([ui.results, ui.passRate, ui.lastFailure], [4, 100, null], 'pass rate from main only');
  assert.deepEqual([api.results, api.flaky], [4, 2], 'flaky counted on every branch');
  assert.deepEqual([overall.branch, overall.runs, overall.otherRuns], ['main', 4, 2]);
  assert.deepEqual(trend.map((t) => t.number), [1, 2, 3, 4]);
  const html = renderHtml(computeMetrics(mixed), { repo: 'o/r', generatedAt: '2026-10-16T09:00:00Z' });
  assert.match(html, /4 CI runs on <code>main<\/code>/);
  assert.match(html, /2 runs on other branches were checked for flaky jobs only/);
});

test('status is the package now: failing, flaky, recovered or stable', () => {
  const history = [
    run(1, 'a1', 'success', [job('broken', 'success'), job('fixed', 'failure'), job('steady', 'success')]),
    run(2, 'a2', 'failure', [job('broken', 'failure'), job('fixed', 'success'), job('steady', 'success')]),
  ];
  const { packages, overall } = computeMetrics(history);
  const by = (n) => packages.find((p) => p.name === n);
  assert.deepEqual([by('broken').latest, by('broken').latestAt], ['failure', '2026-10-12T08:00:00Z']);
  assert.equal(statusOf(by('broken')).label, 'Failing');
  assert.equal(statusOf(by('fixed')).label, 'Recovered', 'failed in the window, passing now');
  assert.equal(statusOf(by('steady')).label, 'Stable');
  assert.equal(statusOf({ latest: 'success', flaky: 2, passRate: 90 }).label, 'Flaky (2)');
  assert.equal(statusOf({ latest: 'failure', flaky: 2, passRate: 90 }).label, 'Failing', 'failing outranks flaky');
  assert.equal(overall.failingNow, 1);
  assert.match(renderHtml(computeMetrics(history), { repo: 'o/r', generatedAt: '2026-10-16T09:00:00Z' }), /Failing now<\/div><div class="value">1</);
});

test('overall totals and the run trend are in date order', () => {
  const { overall, trend } = computeMetrics([...runs].reverse());
  assert.deepEqual([overall.runs, overall.runPassRate, overall.medianRunMinutes], [4, 75, 1.3]);
  assert.deepEqual(trend.map((t) => t.number), [1, 2, 3, 4]);
  assert.deepEqual(trend.map((t) => t.jobPassPct), [100, 100, 50, 100]);
});

test('normalizeRun computes durations from timestamps', () => {
  const r = normalizeRun(
    { id: 9, run_number: 9, event: 'pull_request', head_branch: 'x', head_sha: 's', created_at: '2026-10-16T08:00:00Z', run_started_at: '2026-10-16T08:00:00Z', updated_at: '2026-10-16T08:01:30Z', conclusion: 'success' },
    [{ name: 'api', conclusion: 'success', run_attempt: 2, started_at: '2026-10-16T08:00:10Z', completed_at: '2026-10-16T08:00:40Z' }],
  );
  assert.equal(r.seconds, 90);
  assert.deepEqual(r.jobs, [{ name: 'api', conclusion: 'success', attempt: 2, seconds: 30 }]);
});

test('fetchRuns asks for completed runs and all job attempts, with the token', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (url.includes('/workflows/')) return { ok: true, json: async () => ({ workflow_runs: [{ id: 1, run_number: 1, created_at: '2026-10-16T08:00:00Z', updated_at: '2026-10-16T08:01:00Z', conclusion: 'success', head_sha: 'a' }] }) };
    return { ok: true, json: async () => ({ jobs: [] }) };
  };
  const out = await fetchRuns({ repo: 'o/r', token: 't', limit: 5, fetchImpl });
  assert.equal(out.length, 1);
  assert.match(calls[0].url, /\/repos\/o\/r\/actions\/workflows\/ci\.yml\/runs\?status=completed&per_page=5$/);
  assert.match(calls[1].url, /\/runs\/1\/jobs\?filter=all&per_page=50&page=1$/);
  assert.equal(calls[0].auth, 'Bearer t');
});

test('fetchRuns reports API errors clearly', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(fetchRuns({ repo: 'o/r', fetchImpl }), /GitHub API returned 403/);
});

// A fake GitHub: `runs` run IDs, `jobsOf(id, page)` answers each jobs page (a status
// number means that response fails).
const fakeGitHub = (ids, jobsOf) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/workflows/')) {
      return { ok: true, json: async () => ({ workflow_runs: ids.map((id) => ({ id, run_number: id, conclusion: 'success', head_sha: 'a' })) }) };
    }
    const [, id, page] = url.match(/\/runs\/(\d+)\/jobs\?.*page=(\d+)/) ?? [];
    const answer = jobsOf(Number(id), Number(page), calls.length);
    if (typeof answer === 'number') return { ok: false, status: answer, json: async () => ({}) };
    return { ok: true, json: async () => answer };
  };
  return { fetchImpl, calls };
};
const noSleep = async () => {};
const jobs = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ name: `job ${from + i}`, conclusion: 'success' }));

test('fetchRuns reads every page of jobs (93 jobs: 50 + 43)', async () => {
  const { fetchImpl, calls } = fakeGitHub([1], (_id, page) => ({ total_count: 93, jobs: page === 1 ? jobs(50) : jobs(43, 50) }));
  const [run] = await fetchRuns({ repo: 'o/r', fetchImpl, sleep: noSleep });
  assert.equal(run.jobs.length, 93);
  assert.equal(calls.filter((u) => u.includes('/jobs')).length, 2);
});

test('fetchRuns retries a 502 and succeeds', async () => {
  let failures = 2;
  const waits = [];
  const { fetchImpl } = fakeGitHub([1], () => (failures-- > 0 ? 502 : { total_count: 1, jobs: jobs(1) }));
  const [run] = await fetchRuns({ repo: 'o/r', fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(run.jobs.length, 1);
  assert.deepEqual(waits, [2000, 4000]);
});

test('fetchRuns leaves out one run that keeps failing with 5xx, and says so', async () => {
  const warnings = [];
  const { fetchImpl } = fakeGitHub([1, 2, 3], (id) => (id === 2 ? 502 : { total_count: 1, jobs: jobs(1) }));
  const out = await fetchRuns({ repo: 'o/r', fetchImpl, sleep: noSleep, warn: (m) => warnings.push(m) });
  assert.deepEqual(out.map((r) => r.id), [1, 3]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /::warning::Left out CI run 2: GitHub API returned 502 .* after 3 tries/);
});

test('fetchRuns does not retry or skip a 4xx: it fails at once', async () => {
  let jobCalls = 0;
  const { fetchImpl } = fakeGitHub([1, 2], () => { jobCalls++; return 404; });
  await assert.rejects(fetchRuns({ repo: 'o/r', fetchImpl, sleep: noSleep }), /GitHub API returned 404/);
  assert.equal(jobCalls, 1);
});

test('fetchRuns fails when no run at all could be read', async () => {
  const { fetchImpl } = fakeGitHub([1, 2], () => 503);
  await assert.rejects(fetchRuns({ repo: 'o/r', fetchImpl, sleep: noSleep, warn: () => {} }), /failed for every run/);
});

test('niceMax rounds axis maxima up to clean numbers', () => {
  assert.deepEqual([niceMax(0), niceMax(1.4), niceMax(37), niceMax(56)], [1, 2, 50, 100]);
});

test('renderHtml shows the summary, a row per package, and escapes names', () => {
  const tricky = [...runs, run(5, 'ddd', 'success', [job('<img src=x onerror=alert(1)>', 'success')])];
  const html = renderHtml(computeMetrics(tricky), { repo: 'o/r', generatedAt: '2026-10-16T09:00:00Z' });
  assert.match(html, /<title>CI Dashboard<\/title>/);
  assert.match(html, /Runs fully green<\/div><div class="value">80%/);
  assert.match(html, /<td>api<\/td>/);
  assert.ok(!html.includes('<img src=x'), 'job names must be escaped');
  assert.ok(html.includes(esc('<img src=x onerror=alert(1)>')));
});

test('renderHtml is self-contained and theme-aware', () => {
  const html = renderHtml(computeMetrics(runs), { repo: 'o/r', generatedAt: '2026-10-16T09:00:00Z' });
  assert.ok(!/<script[^>]+src=|<link[^>]+href=/i.test(html), 'no external scripts or styles');
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /Show run-by-run data/);
});

test('embedded chart data cannot close the script tag', () => {
  const html = renderHtml(computeMetrics([run(1, 'a', 'success', [job('x</script><b>', 'success')])]), { repo: 'o/r', generatedAt: '2026-10-16T09:00:00Z' });
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.equal((script.match(/<\/script>/g) ?? []).length, 1);
});
