// What the CI runs cost in minutes (A452), measured from real job timings. GitHub bills each job
// rounded up to a whole minute, so a six-second job costs the same as a fifty-nine-second one;
// this is where the report looks for savings: the rounding, the slowest jobs, and the jobs that
// cost the most on pull requests without ever failing there. Public repositories run free, so
// the numbers are minutes, not money; the rate is the reader's to apply.
import { quantile } from './metrics.ts';

export interface JobTiming { name: string; seconds: number; conclusion: string }
export interface RunTimings { id: number; event: string; createdAt: string; jobs: JobTiming[] }
export interface Snapshot { repo: string; from: string; to: string; runs: RunTimings[] }

/**
 * The name a job is counted under. The shards of one matrix are one job ("regression (shard 1/3)",
 * "(shard 2/3)", and after a change "(shard 1/1)"), so their minutes are added up and the name
 * does not change when the number of shards does.
 */
export const jobKey = (name: string): string => name.replace(/\(shard [^)]*\)/, '(shards)');

/** Jobs that never started are not billed; a cancelled job is billed for the time it ran. */
const billable = (job: JobTiming) => job.conclusion !== 'skipped' && job.seconds > 0;

/** Billed minutes of one job: rounded up to a whole minute. */
export const billedMinutes = (seconds: number): number => (seconds > 0 ? Math.ceil(seconds / 60) : 0);

export const KINDS = ['browser', 'api', 'container', 'ai', 'tools', 'housekeeping'] as const;
export type Kind = (typeof KINDS)[number];

/**
 * Problems that stop the page: a job with no kind, or a kind that does not exist. Names are
 * compared by `jobKey`, so all the shards of a matrix need one tag.
 */
export function checkTags(tags: Record<string, string>, jobNames: string[]): string[] {
  const problems: string[] = [];
  const keys = new Set(jobNames.map(jobKey));
  for (const name of [...keys].sort()) {
    if (!(name in tags)) problems.push(`job "${name}" has no kind in data/job-tags.json`);
  }
  for (const [name, kind] of Object.entries(tags)) {
    if (!(KINDS as readonly string[]).includes(kind)) problems.push(`"${name}" is tagged "${kind}", which is not one of ${KINDS.join(', ')}`);
  }
  return problems;
}

/** Tags for jobs that did not run in these runs: a job on a rare trigger, or one that was removed. Reported, never fatal. */
export function staleTags(tags: Record<string, string>, jobNames: string[]): string[] {
  const keys = new Set(jobNames.map(jobKey));
  return Object.keys(tags).filter((name) => !keys.has(name)).sort();
}

export interface JobCost {
  name: string;
  kind: string;
  runs: number; // runs in which the job actually ran
  seconds: number;
  billed: number; // billed minutes
  medianSeconds: number;
  p90Seconds: number;
}

export function perJob(runs: RunTimings[], tags: Record<string, string>): JobCost[] {
  const byName = new Map<string, number[]>();
  for (const run of runs) {
    for (const job of run.jobs.filter(billable)) byName.set(jobKey(job.name), [...(byName.get(jobKey(job.name)) ?? []), job.seconds]);
  }
  return [...byName].map(([name, secs]) => {
    const sorted = [...secs].sort((a, b) => a - b);
    return {
      name,
      kind: tags[name] ?? 'untagged',
      runs: secs.length,
      seconds: secs.reduce((a, b) => a + b, 0),
      billed: secs.reduce((a, s) => a + billedMinutes(s), 0),
      medianSeconds: Math.round(quantile(sorted, 0.5)!),
      p90Seconds: Math.round(quantile(sorted, 0.9)!),
    };
  }).sort((a, b) => b.billed - a.billed || a.name.localeCompare(b.name));
}

export interface KindCost { kind: string; jobs: number; billed: number; seconds: number }

export function perKind(jobs: JobCost[]): KindCost[] {
  const byKind = new Map<string, KindCost>();
  for (const j of jobs) {
    const k = byKind.get(j.kind) ?? { kind: j.kind, jobs: 0, billed: 0, seconds: 0 };
    byKind.set(j.kind, { kind: j.kind, jobs: k.jobs + 1, billed: k.billed + j.billed, seconds: k.seconds + j.seconds });
  }
  return [...byKind.values()].sort((a, b) => b.billed - a.billed);
}

export interface Totals { runs: number; jobRuns: number; seconds: number; billed: number; roundedUp: number }

/** Minutes the jobs ran, minutes billed, and the difference: minutes paid for that nothing ran in. */
export function totals(runs: RunTimings[]): Totals {
  let seconds = 0;
  let billed = 0;
  let jobRuns = 0;
  for (const run of runs) {
    for (const job of run.jobs.filter(billable)) {
      seconds += job.seconds;
      billed += billedMinutes(job.seconds);
      jobRuns += 1;
    }
  }
  return { runs: runs.length, jobRuns, seconds, billed, roundedUp: billed - seconds / 60 };
}

export interface MergeSaving { jobs: string[]; billedNow: number; billedMerged: number; saved: number }

/**
 * Savings from running the quick jobs as one: the jobs whose longest run is under `limit` seconds,
 * billed separately today and as one job per run if merged. Measured from the timings; the setup
 * each separate job repeats (checkout, install) is not counted, so the real saving is larger.
 */
export function mergeQuickJobs(runs: RunTimings[], limit = 30): MergeSaving {
  const longest = new Map<string, number>();
  for (const run of runs) for (const job of run.jobs.filter(billable)) longest.set(jobKey(job.name), Math.max(longest.get(jobKey(job.name)) ?? 0, job.seconds));
  const quick = new Set([...longest].filter(([, s]) => s < limit).map(([name]) => name));
  let billedNow = 0;
  let billedMerged = 0;
  for (const run of runs) {
    const mine = run.jobs.filter((j) => billable(j) && quick.has(jobKey(j.name)));
    billedNow += mine.reduce((a, j) => a + billedMinutes(j.seconds), 0);
    billedMerged += billedMinutes(mine.reduce((a, j) => a + j.seconds, 0));
  }
  return { jobs: [...quick].sort(), billedNow, billedMerged, saved: billedNow - billedMerged };
}

export interface PrCandidate { name: string; kind: string; prRuns: number; prBilled: number; failedOnPr: number }

/**
 * The jobs that cost the most minutes on pull request runs and failed on none of them in the
 * window. Moving one to main only would save its pull request minutes. "Never failed here" is
 * not "never useful": the list is where to look, not a decision.
 */
export function prCandidates(runs: RunTimings[], tags: Record<string, string>, top = 5): PrCandidate[] {
  const prs = runs.filter((r) => r.event === 'pull_request');
  const by = new Map<string, PrCandidate>();
  for (const run of prs) {
    for (const job of run.jobs.filter(billable)) {
      const key = jobKey(job.name);
      const c = by.get(key) ?? { name: key, kind: tags[key] ?? 'untagged', prRuns: 0, prBilled: 0, failedOnPr: 0 };
      c.prRuns += 1;
      c.prBilled += billedMinutes(job.seconds);
      if (job.conclusion === 'failure' || job.conclusion === 'timed_out') c.failedOnPr += 1; // a cancelled job is usually a pushed-over run, not a failure
      by.set(key, c);
    }
  }
  return [...by.values()].filter((c) => c.failedOnPr === 0).sort((a, b) => b.prBilled - a.prBilled || a.name.localeCompare(b.name)).slice(0, top);
}

const min = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const secs = (n: number) => `${n} s`;

export function costMarkdown(snapshot: Snapshot, tags: Record<string, string>): string {
  const { runs } = snapshot;
  const jobs = perJob(runs, tags);
  const t = totals(runs);
  const merge = mergeQuickJobs(runs);
  const prs = runs.filter((r) => r.event === 'pull_request');
  const candidates = prCandidates(runs, tags);
  const prBilledAll = totals(prs).billed;
  const perRun = t.runs ? t.billed / t.runs : 0;
  const lines = [
    '# CI cost audit',
    '',
    `The ${t.runs} CI runs of ${snapshot.repo} created from ${snapshot.from} to ${snapshot.to} (UTC dates; ${prs.length} on pull requests, ${t.runs - prs.length} on main, nightly or manual). Job timings are the real start and end times GitHub recorded, every attempt of a re-run included. A job that was skipped, or that has no recorded run time, is not counted; a cancelled job counts for the time it ran. All the jobs run on \`ubuntu-latest\`, so no runner multiplier applies (Windows and macOS minutes would count double or more). This repository is public, so the runs are free: the numbers are minutes, and the price is whatever rate you apply.`,
    '',
    '## The totals',
    '',
    '| | Minutes |',
    '|---|---:|',
    `| Time the jobs actually ran | ${min(t.seconds / 60)} |`,
    `| Billed (each job rounded up to a whole minute) | ${min(t.billed)} |`,
    `| Billed for time nothing ran in | ${min(t.roundedUp)} (${t.billed ? Math.round((t.roundedUp / t.billed) * 100) : 0}% of the bill) |`,
    `| Billed per run, on average | ${min(perRun)} |`,
    '',
    '## Where the minutes go, by kind of job',
    '',
    'Each job has one kind in [`data/job-tags.json`](../data/job-tags.json); a job with no kind fails the check, so the totals add up to the whole.',
    '',
    '| Kind | Jobs | Billed minutes | Share |',
    '|---|---:|---:|---:|',
    ...perKind(jobs).map((k) => `| ${k.kind} | ${k.jobs} | ${min(k.billed)} | ${t.billed ? Math.round((k.billed / t.billed) * 100) : 0}% |`),
    '',
    '## The costliest jobs',
    '',
    '| Job | Kind | Job runs | Median | Slowest 10% | Billed minutes |',
    '|---|---|---:|---:|---:|---:|',
    ...jobs.slice(0, 8).map((j) => `| ${j.name} | ${j.kind} | ${j.runs} | ${secs(j.medianSeconds)} | ${secs(j.p90Seconds)} | ${min(j.billed)} |`),
    '',
    '## Savings, measured',
    '',
    merge.jobs.length === 0
      ? '**Run the quick jobs as one.** No job stayed under 30 seconds, so there is nothing to merge.'
      : `**Run the quick jobs as one.** ${merge.jobs.length} ${merge.jobs.length === 1 ? 'job' : 'jobs'} never ran longer than 30 seconds (${merge.jobs.join(', ')}). Billed one by one they cost ${min(merge.billedNow)} minutes in this window; run as one job per run they would cost ${min(merge.billedMerged)}. That saves ${min(merge.saved)} billed minutes (${t.billed ? Math.round((merge.saved / t.billed) * 100) : 0}% of the bill), and the checkout and install each job repeats is on top of that and not counted.`,
    '',
    ...(candidates.length === 0
      ? [`**Move a job that never fails on pull requests to main.** ${prs.length} pull request runs in this window, and no job to move: every job that ran on them failed at least once.`]
      : [
          `**Move a job that never fails on pull requests to main.** ${prs.length} pull request runs billed ${min(prBilledAll)} minutes. The ${candidates.length} costliest jobs that failed on none of them:`,
          '',
          '| Job | Kind | Job runs on pull requests | Billed minutes | Failed on a pull request |',
          '|---|---|---:|---:|---:|',
          ...candidates.map((c) => `| ${c.name} | ${c.kind} | ${c.prRuns} | ${min(c.prBilled)} | ${c.failedOnPr} |`),
          '',
          `Moving ${candidates.length === 1 ? 'it' : `all ${candidates.length}`} to main would save ${min(candidates.reduce((a, c) => a + c.prBilled, 0))} minutes (${prBilledAll ? Math.round((candidates.reduce((a, c) => a + c.prBilled, 0) / prBilledAll) * 100) : 0}% of the pull request minutes). That is where to look, not a decision: a job that never failed in ${prs.length} runs may be the one that catches the next bug, and \`scripts/test-scope.mjs\` already skips the packages a pull request does not touch.`,
        ]),
    '',
  ];
  return lines.join('\n');
}
