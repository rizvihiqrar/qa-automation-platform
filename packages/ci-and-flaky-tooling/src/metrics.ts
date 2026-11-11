// The run-based numbers in the quality report. Each takes workflow runs of one branch
// (here: CI on main) and returns plain numbers, so the report can print the definition
// next to the value. Nothing here counts tests: a bigger number of tests says nothing
// about whether they catch anything.

export interface Run {
  id: number;
  createdAt: string; // ISO time the run was created
  startedAt: string; // ISO time the latest attempt started
  updatedAt: string; // ISO time the latest attempt ended
  attempt: number; // 1 for a first run, 2 or more after a re-run
  /** How attempt 1 ended, when there was a re-run; null for a run that was never re-run. */
  firstAttempt: string | null;
  conclusion: string | null; // success, failure, cancelled, skipped, ...
}

const isDone = (run: Run) => run.conclusion === 'success' || run.conclusion === 'failure';

/** Cancelled and skipped runs say nothing about the code, so every metric leaves them out. */
export const finished = (runs: Run[]): Run[] => runs.filter(isDone);

/** The runs created in one calendar month (UTC), as `YYYY-MM`. */
export function inMonth(runs: Run[], month: string): Run[] {
  return runs.filter((run) => run.createdAt.startsWith(`${month}-`));
}

export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}

const sortedAsc = (values: number[]) => [...values].sort((a, b) => a - b);

export interface FlakyRate { flaky: number; total: number; rate: number | null }

/**
 * Runs whose first attempt failed and a later attempt passed, out of runs that finished. A green
 * run that someone ran again (to refresh an artifact, say) has attempt 2 too, but its first
 * attempt passed, so it is not flaky.
 */
export function flakyRate(runs: Run[]): FlakyRate {
  const done = finished(runs);
  const flaky = done.filter((run) => run.conclusion === 'success' && run.attempt > 1 && run.firstAttempt === 'failure').length;
  return { flaky, total: done.length, rate: done.length === 0 ? null : flaky / done.length };
}

export interface RedMain {
  /** Hours from the first red run to the start of the next green one, for each red that ended. */
  fixHours: number[];
  medianHours: number | null;
  /** A red that has not ended: when it began and how long it has lasted. */
  stillRed: { since: string; hours: number } | null;
}

const hoursBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;

/**
 * How long main stays red. A red starts at the first failed run after a green one and ends at
 * the start of the next successful run, so several failures in a row are one red, and the time
 * is an upper bound by at most one run. A red still open at `now` is reported apart, never
 * dropped, because dropping it would make a long outage improve the number.
 *
 * Pass every run fetched, not only the month's: a red that began in one month and ended in the
 * next is counted in the month it ended, and `month` says which that is. Without `month`, every
 * red counts.
 */
export function timeToFixRedMain(runs: Run[], now: string, month?: string): RedMain {
  const ordered = finished(runs).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const fixHours: number[] = [];
  let since: string | null = null;
  for (const run of ordered) {
    if (run.conclusion === 'failure' && since === null) since = run.createdAt;
    else if (run.conclusion === 'success' && since !== null) {
      if (month === undefined || run.createdAt.startsWith(`${month}-`)) fixHours.push(hoursBetween(since, run.createdAt));
      since = null;
    }
  }
  return {
    fixHours,
    medianHours: quantile(sortedAsc(fixHours), 0.5),
    // an open red that began after the month belongs to another month
    stillRed: since === null || (month !== undefined && since.slice(0, 7) > month) ? null : { since, hours: hoursBetween(since, now) },
  };
}

export interface RunTime { count: number; medianMinutes: number | null; p90Minutes: number | null }

/** How long a CI run takes from the start of its last attempt to its end. */
export function runTime(runs: Run[]): RunTime {
  const minutes = sortedAsc(finished(runs).map((run) => Math.max(0, (Date.parse(run.updatedAt) - Date.parse(run.startedAt)) / 60_000)));
  const round = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);
  return { count: minutes.length, medianMinutes: round(quantile(minutes, 0.5)), p90Minutes: round(quantile(minutes, 0.9)) };
}
