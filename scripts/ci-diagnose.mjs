// Diagnosis of a CI failure on main that a re-run confirmed (.github/workflows/ci-recheck.yml):
// which jobs failed, the error lines from their logs, the last green run and the commits
// since it, and a prompt to paste into a Claude Code session to fix it. Nothing here
// changes code; a person starts the fix and reviews it.
//
//   GITHUB_TOKEN=… node scripts/ci-diagnose.mjs --run <run id> [--repo owner/name] [--out diagnosis.md]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lines in a job log that say what went wrong, without the runner's timestamps.
const ERROR = /##\[error\]|✘|✖|\bError:|AssertionError|\bFAIL\b|not ok \d|failed\b|Expected|Received|exit code [1-9]/;
// Download progress, warnings, and tests expected to fail (test.fail, "[known defect]").
const NOISE = /Process completed with exit code|DeprecationWarning|npm (notice|warn)|##\[group\]|retries left|Received \d+ of \d+|\[known defect\]/;

export function errorLines(log, max = 15) {
  const lines = log.split(/\r?\n/)
    .map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '').replace(/\u001b\[[\d;]*m/g, '').trimEnd())
    .filter((l) => ERROR.test(l) && !NOISE.test(l));
  const unique = [...new Set(lines)];
  return unique.length > max ? [...unique.slice(0, max), `… ${unique.length - max} more`] : unique;
}

// The CI command each package job runs, from the matrix in ci.yml.
export function ciCommands(yaml) {
  return Object.fromEntries([...yaml.matchAll(/- \{ package: ([\w-]+),.*?command: (.+?)(?:, smoke: .+)? \}$/gm)].map(([, p, c]) => [p, c.trim()]));
}

export function report({ repo, run, failedJobs, lastGreen, commits, commands }) {
  const jobs = failedJobs.map((j) => {
    const cmd = commands[j.name];
    return [
      `### ${j.name}`,
      cmd ? `Runs in \`packages/${j.name}\`: \`${cmd}\`` : '',
      j.errors.length ? '```\n' + j.errors.join('\n') + '\n```' : '_No error lines found; open the log._',
      `[Log](${j.url})`,
    ].filter(Boolean).join('\n\n');
  });
  const since = lastGreen
    ? [`Last green run on main: [#${lastGreen.number}](${lastGreen.url}) at \`${lastGreen.sha.slice(0, 7)}\`. Commits since:`, '',
      ...(commits.length ? commits.map((c) => `- \`${c.sha.slice(0, 7)}\` ${c.message}`) : ['- none (the same commit passed before: suspect the environment or a live site)'])]
    : ['No green run on main in the recent history.'];
  const prompt = [
    `Fix the CI failure on main of ${repo}. Read my memory and github-portfolio-notes.md first.`,
    `Failing run: ${run.url} (it failed again when re-run, so it is not a one-off).`,
    `Failing jobs: ${failedJobs.map((j) => j.name).join(', ')}.`,
    lastGreen ? `Last green run: ${lastGreen.url} at ${lastGreen.sha.slice(0, 7)}; ${commits.length} commit(s) since.` : '',
    'Reproduce it locally with the job\'s CI command, find the root cause (don\'t just retry, raise a timeout or loosen a check without saying why), fix it with a test that fails without the fix, then ship it on a branch and merge on green CI.',
  ].filter(Boolean).join(' ');
  return [
    `**CI failed on main and failed again when re-run:** [run #${run.number}](${run.url}), \`${run.sha.slice(0, 7)}\`, ${run.event}.`,
    '',
    ...jobs.flatMap((j) => [j, '']),
    ...since,
    '',
    '**To fix it,** paste this into a Claude Code session:',
    '',
    '```text\n' + prompt + '\n```',
    '',
  ].join('\n');
}

async function api(url, token, { text = false } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return text ? res.text() : res.json();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repo = arg('--repo', process.env.GITHUB_REPOSITORY ?? 'rizvihiqrar/qa-automation-platform');
  const id = arg('--run');
  const r = await api(`/repos/${repo}/actions/runs/${id}`, token);
  const run = { number: r.run_number, url: r.html_url, sha: r.head_sha, event: r.event, attempt: r.run_attempt };
  const { jobs } = await api(`/repos/${repo}/actions/runs/${id}/attempts/${r.run_attempt}/jobs?per_page=100`, token);
  const failedJobs = [];
  for (const j of jobs.filter((x) => x.conclusion === 'failure')) {
    let errors = [];
    try { errors = errorLines(await api(`/repos/${repo}/actions/jobs/${j.id}/logs`, token, { text: true })); } catch { /* log expired or unavailable */ }
    failedJobs.push({ name: j.name, url: j.html_url, errors });
  }
  // The last green run on main BEFORE this one: what changed since is the first suspect.
  const { workflow_runs: recent } = await api(`/repos/${repo}/actions/workflows/${r.workflow_id}/runs?branch=main&status=success&per_page=1&created=<${r.created_at}`, token);
  const g = recent[0];
  const lastGreen = g ? { number: g.run_number, url: g.html_url, sha: g.head_sha } : null;
  let commits = [];
  if (lastGreen && lastGreen.sha !== run.sha) {
    const cmp = await api(`/repos/${repo}/compare/${lastGreen.sha}...${run.sha}`, token);
    commits = cmp.commits.map((c) => ({ sha: c.sha, message: c.commit.message.split('\n')[0] }));
  }
  const commands = ciCommands(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const md = report({ repo, run, failedJobs, lastGreen, commits, commands });
  console.log(md);
  const out = arg('--out');
  if (out) fs.writeFileSync(out, md);
}
