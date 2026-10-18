// Daily CI health check (.github/workflows/ci-health.yml): reads the latest run of
// every workflow on main in each watched repo and reports any that failed, and any
// scheduled workflow that hasn't run when it should have (GitHub turns schedules
// off in a repo with no activity for 60 days, without failing anything).
//
//   GITHUB_TOKEN=… node scripts/ci-health.mjs [--out ci-health.md]
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

const FAILED = ['failure', 'timed_out', 'startup_failure'];

// One row per workflow. `runs` are that workflow's runs on main, newest first.
// Cancelled runs are skipped: CI cancels a run when a newer push supersedes it.
export function assess(name, runs, overdueAfterHours, now) {
  const done = runs.filter((r) => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
  const last = done[0];
  const limit = overdueAfterHours[name];
  if (!last) return { workflow: name, state: limit ? 'overdue' : 'never run', detail: 'no finished run on main' };
  const ageHours = (now - Date.parse(last.created_at)) / HOUR;
  const base = { workflow: name, conclusion: last.conclusion, url: last.html_url, at: last.created_at, event: last.event };
  if (FAILED.includes(last.conclusion)) return { ...base, state: 'failing' };
  if (limit && ageHours > limit) return { ...base, state: 'overdue', detail: `last run ${Math.round(ageHours)} hours ago, expected within ${limit}` };
  return { ...base, state: 'ok' };
}

export const PROBLEMS = ['failing', 'overdue', 'missing'];

// Watched scheduled workflows that no longer exist are problems too.
export function missing(names, overdueAfterHours) {
  return Object.keys(overdueAfterHours).filter((n) => !names.includes(n))
    .map((n) => ({ workflow: n, state: 'missing', detail: 'scheduled workflow not found' }));
}

export function report(results, now) {
  const problems = results.flatMap(({ repo, rows }) => rows.filter((r) => PROBLEMS.includes(r.state)).map((r) => ({ repo, ...r })));
  const lines = [
    problems.length ? `**${problems.length} problem${problems.length > 1 ? 's' : ''}** on ${now.toISOString().slice(0, 10)}:` : `All green on ${now.toISOString().slice(0, 10)}.`,
    '',
    '| Repo | Workflow | State | Last run on main |',
    '|---|---|---|---|',
    ...results.flatMap(({ repo, rows }) => rows.map((r) => {
      const state = PROBLEMS.includes(r.state) ? `**${r.state}**${r.detail ? `: ${r.detail}` : ''}` : r.state;
      const last = r.url ? `[${r.conclusion}, ${r.at.slice(0, 16).replace('T', ' ')} UTC](${r.url}) (${r.event})` : (r.detail ?? '');
      return `| ${repo.split('/')[1]} | ${r.workflow} | ${state} | ${last} |`;
    })),
  ];
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
    const active = workflows.filter((w) => w.state === 'active');
    const rows = [];
    for (const w of active) {
      const { workflow_runs: runs } = await api(`/repos/${repo}/actions/workflows/${w.id}/runs?branch=main&per_page=20`, token);
      rows.push(assess(w.name, runs, overdueAfterHours, now.getTime()));
    }
    rows.push(...missing(active.map((w) => w.name), overdueAfterHours));
    results.push({ repo, rows });
  }
  const { problems, markdown } = report(results, now);
  console.log(markdown);
  if (out) fs.writeFileSync(out, markdown);
  process.exit(problems.length ? 1 : 0);
}
