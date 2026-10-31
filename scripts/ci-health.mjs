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
import { onMain } from './run-select.mjs';

const HOUR = 3600_000;

// Scheduled workflows (and the Dashboard, rebuilt after every CI run on main and every
// 3 hours: overdue after 6) and how long after their last run they count as overdue. Monitor runs every
// 30 minutes, so 3 hours is six missed runs: a monitor that stopped (GitHub also switches
// schedules off after 60 days without activity) must not look fine.
// scripts/ci-health.test.mjs fails when a scheduled workflow is missing from this list.
export const WATCH = [
  { repo: 'rizvihiqrar/qa-automation-platform', overdueAfterHours: { CI: 26, Dashboard: 6, Mutation: 8 * 24, Monitor: 3 } },
  { repo: 'rizvihiqrar/cicd-pipeline-demo', overdueAfterHours: {} },
  { repo: 'rizvihiqrar/rizvihiqrar', overdueAfterHours: { 'Refresh screenshots': 8 * 24 } },
];

export const METRICS_URL = 'https://rizvihiqrar.github.io/qa-automation-platform/metrics.json';

const FAILED = ['failure', 'timed_out', 'startup_failure'];

// The events a workflow file's `on:` runs it for. Handles the three YAML forms
// (`on: push`, `on: [push, pull_request]`, and a block of `event:` keys).
export function triggers(yaml) {
  const lines = yaml.split(/\r?\n/);
  const i = lines.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (i < 0) return [];
  const inline = lines[i].replace(/^[^:]+:/, '').replace(/#.*/, '').trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  const events = [];
  for (const line of lines.slice(i + 1)) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^ {1,4}([a-z_]+):/) ?? line.match(/^ {1,4}- ([a-z_]+)\s*$/);
    if (m && line.search(/\S/) === lines[i + 1].search(/\S/)) events.push(m[1]);
  }
  return events;
}

// Started by hand only (workflow_dispatch): no run on main is normal, not a problem.
export const manualOnly = (events) => events.length > 0 && events.every((e) => e === 'workflow_dispatch');

// One row per workflow. `runs` are that workflow's runs on main, newest first.
// Cancelled runs are skipped: CI cancels a run when a newer push supersedes it.
// `manual` marks a workflow that only runs when started by hand.
export const finished = (runs) => runs.filter((r) => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');

export function assess(name, runs, overdueAfterHours, now, { manual = false } = {}) {
  const done = finished(runs);
  const last = done[0];
  const limit = overdueAfterHours[name];
  if (!last && manual) return { workflow: name, state: 'manual', detail: 'runs only when started by hand; none on main yet' };
  if (!last) return { workflow: name, state: limit ? 'overdue' : 'never run', detail: 'no finished run on main' };
  const ageHours = (now - Date.parse(last.created_at)) / HOUR;
  const passed = done.filter((r) => r.conclusion === 'success').length;
  const base = { workflow: name, conclusion: last.conclusion, url: last.html_url, at: last.created_at, event: last.event, passed, total: done.length };
  if (FAILED.includes(last.conclusion)) return { ...base, state: 'failing' };
  if (limit && ageHours > limit) return { ...base, state: 'overdue', detail: `last run ${Math.round(ageHours)} hours ago, expected within ${limit}` };
  return { ...base, state: 'ok' };
}

export const PROBLEMS = ['failing', 'overdue', 'missing', 're-run'];

// Workflows that only run in reaction to another workflow's failure. Their latest run is a
// diagnosis, not the state of main, and nothing re-runs them once the failure is fixed.
// 2026-10-31: CI recheck confirmed the audit failure, CI went green after the fix, and the
// ci-health issue stayed open for good because CI recheck's latest run was still that failure.
export const REACTIVE = ['CI recheck'];

// A reactive workflow's failure stops counting once every other workflow in the repo is
// free of problems: whatever it diagnosed has been fixed. While anything else is still a
// problem it stays failing, so a confirmed failure is never hidden.
export function settle(rows) {
  const others = rows.filter((r) => !REACTIVE.includes(r.workflow));
  if (others.some((r) => PROBLEMS.includes(r.state))) return rows;
  return rows.map((r) => REACTIVE.includes(r.workflow) && r.state === 'failing'
    ? { ...r, state: 'resolved', detail: 'diagnosed a failure on main; every other workflow is green now' }
    : r);
}

// Runs on main whose latest attempt started within the window and that needed more
// than one attempt. The daily check looks back 25 hours, so a late start misses nothing.
export const RERUN_WINDOW_HOURS = 25;
export function reruns(runs, now, windowHours = RERUN_WINDOW_HOURS) {
  return runs.filter((r) => (r.run_attempt ?? 1) > 1 && now - Date.parse(r.run_started_at ?? r.created_at) <= windowHours * HOUR);
}

// The pull request merged to main after the run that names the run's ID in its body
// or a comment: the fix for whatever needed the re-run. `prs` are
// { number, merged_at, texts: [body, ...comments] }.
export function fixedBy(run, prs) {
  const id = new RegExp(`(^|\\D)${run.id}(\\D|$)`);
  return prs.find((p) => p.merged_at && Date.parse(p.merged_at) > Date.parse(run.created_at) && p.texts.some((t) => id.test(t ?? '')));
}

// One row per re-run run. `firstJobs` are the jobs of its first attempt: the ones
// that failed there are the jobs that needed the re-run. Once a merged fix names the
// run (`fix`), the row is no longer a problem.
export function rerunRow(name, run, firstJobs, fix = null) {
  const failed = firstJobs.filter((j) => FAILED.includes(j.conclusion)).map((j) => j.name);
  const jobs = failed.length ? failed.join(', ') : 'no failed job recorded';
  return {
    workflow: name, state: fix ? 'fixed' : 're-run', conclusion: run.conclusion, url: run.html_url, at: run.created_at, event: run.event,
    detail: `${jobs} failed on attempt 1, run took ${run.run_attempt} attempts (${run.conclusion} in the end)${fix ? `; fixed in #${fix.number}` : ''}`,
  };
}

// Pull requests merged to main in the window, with their body and comments, for fixedBy.
async function mergedPrs(repo, token, now, windowHours) {
  const pulls = await api(`/repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=50`, token);
  const recent = pulls.filter((p) => p.merged_at && now - Date.parse(p.merged_at) <= windowHours * HOUR);
  return Promise.all(recent.map(async (p) => {
    const comments = await api(`/repos/${repo}/issues/${p.number}/comments?per_page=100`, token);
    return { number: p.number, merged_at: p.merged_at, texts: [p.body, ...comments.map((c) => c.body)] };
  }));
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
      const state = PROBLEMS.includes(r.state) ? `**${r.state}**${r.detail ? `: ${r.detail}` : ''}` : ['fixed', 'resolved'].includes(r.state) ? `${r.state}: ${r.detail}` : r.state;
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

// A dropped connection or a 5xx from GitHub is retried a few times: one such blip on
// 2026-10-30 ("fetch failed: other side closed") failed the whole daily check.
// A request that hangs is cut off after timeoutMs and retried too.
export async function api(url, token, { fetchImpl = fetch, tries = 4, waitMs = 2000, timeoutMs = 30000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(`https://api.github.com${url}`, {
        headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt >= tries) throw err;
    }
    if (res && !(res.status >= 500 && attempt < tries)) {
      if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
      return res.json();
    }
    await res?.text(); // free the connection before trying again
    await new Promise((r) => setTimeout(r, waitMs * attempt));
  }
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
    let prs = null; // fetched once, only if a run needed a re-run
    for (const w of active) {
      // Unfiltered, then picked here: GitHub's branch filter returned nothing during an incident.
      const { workflow_runs: all } = await api(`/repos/${repo}/actions/workflows/${w.id}/runs?per_page=100`, token);
      const runs = onMain(all);
      // The workflow file is read only when there is no run to go by.
      let manual = false;
      if (!finished(runs).length) {
        const file = await api(`/repos/${repo}/contents/${w.path}`, token);
        manual = manualOnly(triggers(Buffer.from(file.content, 'base64').toString('utf8')));
      }
      rows.push(assess(w.name, runs, overdueAfterHours, now.getTime(), { manual }));
      for (const r of reruns(runs, now.getTime())) {
        const { jobs } = await api(`/repos/${repo}/actions/runs/${r.id}/attempts/1/jobs?per_page=100`, token);
        prs ??= await mergedPrs(repo, token, now.getTime(), RERUN_WINDOW_HOURS);
        rows.push(rerunRow(w.name, r, jobs, fixedBy(r, prs)));
      }
    }
    rows.push(...missing(active.map((w) => w.name), overdueAfterHours));
    results.push({ repo, rows: settle(rows) });
  }
  // Per-package pass rates from the published dashboard; the report still goes out without them.
  const packages = await fetch(METRICS_URL).then((r) => (r.ok ? r.json() : {})).then((m) => m.packages ?? []).catch(() => []);
  const { problems, markdown } = report(results, now, packages);
  console.log(markdown);
  if (out) fs.writeFileSync(out, markdown);
  process.exit(problems.length ? 1 : 0);
}
