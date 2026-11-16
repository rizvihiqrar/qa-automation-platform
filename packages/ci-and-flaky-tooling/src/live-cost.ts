// Reads the job timings of recent CI runs from the GitHub API for the cost audit (A452).
// fetch is injectable so tests run on saved samples, without the network.
import { pages, type FetchLike, type LiveOptions } from './live.ts';
import type { RunTimings, Snapshot } from './cost.ts';

interface ApiRun { id: number; event: string; created_at: string; conclusion: string | null }
interface ApiJob { name: string; conclusion: string | null; started_at: string | null; completed_at: string | null }

export const MS_IN_DAY = 86_400_000;

/** Seconds between two ISO times; 0 for a job that never started or finished (skipped, or still going). */
export function jobSeconds(startedAt: string | null, completedAt: string | null): number {
  if (!startedAt || !completedAt) return 0;
  const seconds = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
}

const RETRIES = 3;

/** Tries a read again when GitHub answers 5xx (a busy server, seen as a 502 on 2026-11-16); any other error stops at once. */
export async function retried<T>(read: () => Promise<T>, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      const serverSide = /GitHub answered 5\d\d/.test((error as Error).message);
      if (!serverSide || attempt >= RETRIES) throw error;
      await wait(500 * attempt);
    }
  }
}

export const CONCURRENCY = 8; // jobs of eight runs at a time: one request per run, in order, would take minutes

/**
 * The finished CI runs of the last `days` days (UTC dates) on every branch and event, each with
 * the timing of its jobs. `filter=all` reads the jobs of every attempt, because a re-run is billed
 * as well as the run before it.
 */
export async function fetchCostSnapshot(days: number, now: Date, options: LiveOptions & { fetchImpl?: FetchLike }): Promise<Snapshot> {
  const from = new Date(now.getTime() - days * MS_IN_DAY).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const base = `https://api.github.com/repos/${options.repo}/actions`;
  const runs = await pages<ApiRun>(`${base}/workflows/ci.yml/runs?status=completed&created=${encodeURIComponent(`${from}..${to}`)}`, options, (body) => (body as { workflow_runs?: ApiRun[] }).workflow_runs ?? []);
  const timed: RunTimings[] = [];
  for (let at = 0; at < runs.length; at += CONCURRENCY) {
    const batch = runs.slice(at, at + CONCURRENCY);
    const jobsOfBatch = await Promise.all(batch.map((run) => retried(() => pages<ApiJob>(`${base}/runs/${run.id}/jobs?filter=all`, options, (body) => (body as { jobs?: ApiJob[] }).jobs ?? []))));
    batch.forEach((run, i) => {
      timed.push({
        id: run.id,
        event: run.event,
        createdAt: run.created_at,
        jobs: jobsOfBatch[i]!.map((j) => ({ name: j.name, seconds: jobSeconds(j.started_at, j.completed_at), conclusion: j.conclusion ?? 'unknown' })),
      });
    });
  }
  return { repo: options.repo, from, to, runs: timed.sort((a, b) => a.id - b.id) };
}
