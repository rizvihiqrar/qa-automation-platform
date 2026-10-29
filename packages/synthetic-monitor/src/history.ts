// The history file and what it says about each site. Pure functions: no clock, no network.

export interface SiteResult {
  ok: boolean;
  /** Milliseconds to load the page on the attempt that counted; null when it never loaded. */
  ms: number | null;
  error?: string;
  /** 1, or 2 when the first attempt failed and the retry inside the run was used. */
  attempts: number;
}

export interface Run {
  /** ISO time the run started. */
  t: string;
  results: Record<string, SiteResult>;
}

export interface History {
  runs: Run[];
}

export type Status = 'up' | 'degraded' | 'down';

export interface SiteSummary {
  site: string;
  status: Status;
  /** Start of the current run of failures, when there is one. */
  failingSince: string | null;
  lastError: string | null;
  /** Share of runs in the history that passed, 0 to 100. */
  uptimePct: number;
  runs: number;
  /** Median load time of the passing runs, in ms. */
  medianMs: number | null;
  latestMs: number | null;
  /** The latest load took more than SLOW_FACTOR times the site's own median. */
  slow: boolean;
  /** Load times of the last SERIES_LENGTH runs, null where the site was down. */
  series: (number | null)[];
}

export const KEEP_DAYS = 30;
/** Failed runs in a row before a site counts as down. One failed run is only "degraded". */
export const DOWN_AFTER = 2;
export const SLOW_FACTOR = 3;
/** Passing runs needed before "slow" means anything. */
export const MIN_SAMPLES = 10;
export const SERIES_LENGTH = 48;

const DAY = 86_400_000;

/** Adds a run and drops anything older than KEEP_DAYS before it. */
export function append(history: History, run: Run, keepDays = KEEP_DAYS): History {
  const cutoff = Date.parse(run.t) - keepDays * DAY;
  // An unreadable time compares false either way, so such a run is kept rather than wiping the history.
  return { runs: [...history.runs, run].filter((r) => !(Date.parse(r.t) < cutoff)) };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function summarize(history: History): SiteSummary[] {
  const latest = history.runs.at(-1);
  if (!latest) return [];
  return Object.keys(latest.results).map((site) => {
    const seen = history.runs.filter((r) => r.results[site]).map((r) => ({ t: r.t, ...r.results[site]! }));
    const last = seen.at(-1)!;

    let failing = 0;
    for (let i = seen.length - 1; i >= 0 && !seen[i]!.ok; i--) failing++;
    const status: Status = failing >= DOWN_AFTER ? 'down' : failing > 0 ? 'degraded' : 'up';

    // Slow is judged against the passing runs before this one, so a very slow load cannot lift its own median.
    const before = seen.slice(0, -1).filter((s) => s.ok && s.ms !== null).map((s) => s.ms!);
    const medianMs = median(before);
    const slow = last.ok && last.ms !== null && before.length >= MIN_SAMPLES && medianMs !== null && last.ms > SLOW_FACTOR * medianMs;

    return {
      site,
      status,
      failingSince: failing ? seen[seen.length - failing]!.t : null,
      lastError: last.ok ? null : (last.error ?? 'failed'),
      uptimePct: Math.round((seen.filter((s) => s.ok).length / seen.length) * 1000) / 10,
      runs: seen.length,
      medianMs,
      latestMs: last.ok ? last.ms : null,
      slow,
      series: seen.slice(-SERIES_LENGTH).map((s) => (s.ok ? s.ms : null)),
    };
  });
}
