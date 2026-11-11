// Reads the repository's real CI runs and escaped-bug issues from the GitHub API.
// fetch is injectable so tests run on saved samples, without the network.
import type { Run } from './metrics.ts';
import type { IssueLike } from './escaped.ts';

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface LiveOptions { repo: string; token?: string | undefined; fetchImpl?: FetchLike }

export const LABEL = 'escaped-bug';
const PAGE = 100;
const MAX_PAGES = 10; // 1,000 items is far more than one month holds; a page limit stops a loop on a bad response
const MARGIN_DAYS = 14; // runs read either side of the month, so a red that crosses a month end can be measured

interface ApiRun {
  id: number; created_at: string; run_started_at?: string | null; updated_at: string;
  run_attempt?: number; conclusion: string | null;
}
interface ApiIssue extends IssueLike { pull_request?: unknown }

async function pages<T>(url: string, { token, fetchImpl = fetch }: LiveOptions, pick: (body: unknown) => T[]): Promise<T[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}per_page=${PAGE}&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`);
    const items = pick(await res.json());
    out.push(...items);
    if (items.length < PAGE) return out;
  }
  // A silent stop would leave a partial month looking complete.
  throw new Error(`more than ${MAX_PAGES * PAGE} items at ${url}: narrow the month or raise MAX_PAGES`);
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Finished CI runs on main from one month (`YYYY-MM`) and MARGIN_DAYS either side, in no promised
 * order. Runs still going are not finished, so they are left out. A run that was re-run and is
 * green now also has its first attempt read, to tell a flaky run from a green one run again.
 */
export async function fetchMainRuns(month: string, options: LiveOptions): Promise<Run[]> {
  const [year, mm] = month.split('-').map(Number) as [number, number];
  const from = Date.UTC(year, mm - 1, 1) - MARGIN_DAYS * 86_400_000;
  const to = Date.UTC(year, mm, 0) + MARGIN_DAYS * 86_400_000;
  const created = encodeURIComponent(`${day(from)}..${day(to)}`);
  const url = `https://api.github.com/repos/${options.repo}/actions/workflows/ci.yml/runs?branch=main&status=completed&created=${created}`;
  const runs = await pages<ApiRun>(url, options, (body) => (body as { workflow_runs?: ApiRun[] }).workflow_runs ?? []);
  return Promise.all(runs.map(async (r) => {
    const attempt = r.run_attempt ?? 1;
    return {
      id: r.id,
      createdAt: r.created_at,
      startedAt: r.run_started_at ?? r.created_at,
      updatedAt: r.updated_at,
      attempt,
      conclusion: r.conclusion,
      firstAttempt: attempt > 1 && r.conclusion === 'success' ? await firstAttemptOf(r.id, options) : null,
    };
  }));
}

async function firstAttemptOf(runId: number, { repo, token, fetchImpl = fetch }: LiveOptions): Promise<string | null> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/runs/${runId}/attempts/1`, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for attempt 1 of run ${runId}`);
  return ((await res.json()) as { conclusion?: string | null }).conclusion ?? null;
}

/** Every issue labelled escaped-bug, open or closed (pull requests share the issues endpoint and are skipped). */
export async function fetchEscapedIssues(options: LiveOptions): Promise<IssueLike[]> {
  const url = `https://api.github.com/repos/${options.repo}/issues?labels=${LABEL}&state=all`;
  const all = await pages<ApiIssue>(url, options, (body) => (Array.isArray(body) ? (body as ApiIssue[]) : []));
  return all.filter((issue) => issue.pull_request === undefined);
}
