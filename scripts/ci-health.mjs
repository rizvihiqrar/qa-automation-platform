// Daily CI health check (.github/workflows/ci-health.yml): reads the latest run of
// every workflow on main in each watched repo and reports any that failed, and any
// scheduled workflow that hasn't run when it should have (GitHub turns schedules
// off in a repo with no activity for 60 days, without failing anything).
//
//   GITHUB_TOKEN=… node scripts/ci-health.mjs [--out ci-health.md]
//
// Also flags every run on main that needed a re-run in the last day: CI recheck
// re-runs a failed job once, and a pass on that second attempt keeps main green, so
// without this a flaky job would only show up as a count on the dashboard.
//
// Exits 1 when something needs looking at. The workflow keeps one open issue
// (label ci-health) while that's true and closes it when everything is green.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOUR = 3600_000;

// Scheduled workflows (and the Dashboard, rebuilt after every CI run on main, so the
// public page is never more than a day old) and how long after their last run they
// count as overdue.
export const WATCH = [
  { repo: 'rizvihiqrar/qa-automation-platform', overdueAfterHours: { CI: 26, Dashboard: 26, Mutation: 8 * 24 } },
  { repo: 'rizvihiqrar/cicd-pipeline-demo', overdueAfterHours: {} },
  { repo: 'rizvihiqrar/rizvihiqrar', overdueAfterHours: { 'Refresh screenshots': 8 * 24 } },
];

export const METRICS_URL = 'https://rizvihiqrar.github.io/qa-automation-platform/metrics.json';

const FAILED = ['failure', 'timed_out', 'startup_failure'];

// One row per workflow. `runs` are that workflow's runs on main, newest first.
// Cancelled runs are skipped: CI cancels a run when a newer push supersedes it.
export function assess(name, runs, overdueAfterHours, now) {
  const done = runs.filter((r) => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
  const last = done[0];
  const limit = overdueAfterHours[name];
  if (!last) return { workflow: name, state: limit ? 'overdue' : 'never run', detail: 'no finished run on main' };
  const ageHours = (now - Date.parse(last.created_at)) / HOUR;
  const passed = done.filter((r) => r.conclusion === 'success').length;
  const base = { workflow: name, conclusion: last.conclusion, url: last.html_url, at: last.created_at, event: last.event, passed, total: done.length };
  if (FAILED.includes(last.conclusion)) return { ...base, state: 'failing' };
  if (limit && ageHours > limit) return { ...base, state: 'overdue', detail: `last run ${Math.round(ageHours)} hours ago, expected within ${limit}` };
  return { ...base, state: 'ok' };
}

export const PROBLEMS = ['failing', 'overdue', 'missing', 're-run'];

// Runs on main whose latest attempt started within the window and that needed more
// than one attempt. The daily check looks back 25 hours, so a late start misses nothing.
export const RERUN_WINDOW_HOURS = 25;
export function reruns(runs, now, windowHours = RERUN_WINDOW_HOURS) {
  return runs.filter((r) => (r.run_attempt ?? 1) > 1 && now - Date.parse(r.run_started_at ?? r.created_at) <= windowHours * HOUR);
}

// One row per re-run run. `firstJobs` are the jobs of its first attempt: the ones
// that failed there are the jobs that needed the re-run.
export function rerunRow(name, run, firstJobs) {
  const failed = firstJobs.filter((j) => FAILED.includes(j.conclusion)).map((j) => j.name);
  const jobs = failed.length ? failed.join(', ') : 'no failed job recorded';
  return {
    workflow: name, state: 're-run', conclusion: run.conclusion, url: run.html_url, at: run.created_at, event: run.event,
    detail: `${jobs} failed on attempt 1, run took ${run.run_attempt} attempts (${run.conclusion} in the end)`,
  };
}

// Watched scheduled workflows that no longer exist are problems too.
export function missing(names, overdueAfterHours) {
  return Object.keys(overdueAfterHours).filter((n) => !names.includes(n))
    .map((n) => ({ workflow: n, state: 'missing', detail: 'scheduled workflow not found' }));
}

// "95% (19/20)", or a dash when there is nothing to count.
export function passRate(passed, total) {
  return total ? `${Math.round((passed / total) * 100)}% (${passed}/${total})` : '–';
}

// `packages` is the published dashboard's metrics.json `packages` list (optional):
// each package's latest job on main and its pass rate over the analysed runs.
export function report(results, now, packages = []) {
  const problems = results.flatMap(({ repo, rows }) => rows.filter((r) => PROBLEMS.includes(r.state)).map((r) => ({ repo, ...r })));
  const lines = [
    problems.length ? `**${problems.length} problem${problems.length > 1 ? 's' : ''}** on ${now.toISOString().slice(0, 10)}:` : `All green on ${now.toISOString().slice(0, 10)}.`,
    '',
    '| Repo | Workflow | State | Passed on main | Last run on main |',
    '|---|---|---|---|---|',
    ...results.flatMap(({ repo, rows }) => rows.map((r) => {
      const state = PROBLEMS.includes(r.state) ? `**${r.state}**${r.detail ? `: ${r.detail}` : ''}` : r.state;
      const last = r.url ? `[${r.conclusion}, ${r.at.slice(0, 16).replace('T', ' ')} UTC](${r.url}) (${r.event})` : (r.detail ?? '');
      return `| ${repo.split('/')[1]} | ${r.workflow} | ${state} | ${passRate(r.passed, r.total)} | ${last} |`;
    })),
  ];
  if (packages.length) {
    const failing = packages.filter((p) => p.latest && p.latest !== 'success').length;
    lines.push('', `**Packages** (qa-automation-platform CI jobs on main): ${packages.length - failing}/${packages.length} passing now`, '',
      '| Package | Latest | Passed on main |', '|---|---|---|',
      ...packages.map((p) => `| ${p.name} | ${p.latest === 'success' || !p.latest ? (p.latest ?? '–') : `**${p.latest}**`} | ${passRate(Math.round((p.passRate ?? 0) * p.results / 100), p.results)} |`));
  }
  return { problems, markdown: lines.join('\n') + '\n' };
}

async function api(url, token) {
  const res = await fetch(`https://api.github.com${url}`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const now = new Date();
  const results = [];
  for (const { repo, overdueAfterHours } of WATCH) {
    const { workflows } = await api(`/repos/${repo}/actions/workflows?per_page=100`, token);
    // Dynamic workflows (Dependabot) are left out: a failed run there means a dependency
    // couldn't be bumped, not that main is broken, and GitHub emails its alerts itself.
    const active = workflows.filter((w) => w.state === 'active' && !w.path.startsWith('dynamic/'));
    const rows = [];
    for (const w of active) {
      const { workflow_runs: runs } = await api(`/repos/${repo}/actions/workflows/${w.id}/runs?branch=main&per_page=20`, token);
      rows.push(assess(w.name, runs, overdueAfterHours, now.getTime()));
      for (const r of reruns(runs, now.getTime())) {
        const { jobs } = await api(`/repos/${repo}/actions/runs/${r.id}/attempts/1/jobs?per_page=100`, token);
        rows.push(rerunRow(w.name, r, jobs));
      }
    }
    rows.push(...missing(active.map((w) => w.name), overdueAfterHours));
    results.push({ repo, rows });
  }
  // Per-package pass rates from the published dashboard; the report still goes out without them.
  const packages = await fetch(METRICS_URL).then((r) => (r.ok ? r.json() : {})).then((m) => m.packages ?? []).catch(() => []);
  const { problems, markdown } = report(results, now, packages);
  console.log(markdown);
  if (out) fs.writeFileSync(out, markdown);
  process.exit(problems.length ? 1 : 0);
}
