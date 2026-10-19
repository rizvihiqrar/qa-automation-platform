// Reads recent workflow runs and their jobs (all attempts) from the GitHub API.

const seconds = (start, end) => (start && end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000)) : null);

export function normalizeRun(run, jobs) {
  return {
    id: run.id,
    number: run.run_number,
    event: run.event,
    branch: run.head_branch,
    sha: run.head_sha,
    createdAt: run.created_at,
    conclusion: run.conclusion,
    seconds: seconds(run.run_started_at ?? run.created_at, run.updated_at),
    jobs: jobs.map((j) => ({
      name: j.name,
      conclusion: j.conclusion,
      attempt: j.run_attempt ?? 1,
      seconds: seconds(j.started_at, j.completed_at),
    })),
  };
}

/**
 * The slice of fetch this module uses, so tests can pass a small fake.
 * @typedef {(url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean, status?: number, json(): Promise<any> }>} FetchLike
 */

export const JOBS_PER_PAGE = 50;
export const ATTEMPTS = 3;

/**
 * @param {{ repo: string, token?: string, workflow?: string, limit?: number, fetchImpl?: FetchLike,
 *   sleep?: (ms: number) => Promise<void>, warn?: (message: string) => void }} options
 */
export async function fetchRuns({
  repo, token, workflow = 'ci.yml', limit = 40, fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn = (message) => console.warn(message),
}) {
  /** @type {Record<string, string>} */
  const headers = { Accept:'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // A 5xx is GitHub's side and usually passes: try again, waiting 2 s then 4 s. Anything
  // else (bad token, wrong repo) won't change on retry and fails at once.
  const get = async (path) => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(`https://api.github.com${path}`, { headers });
      if (res.ok) return res.json();
      const status = res.status ?? 0;
      if (status < 500 || attempt === ATTEMPTS) throw new Error(`GitHub API returned ${status} for ${path}`);
      await sleep(2000 * attempt);
    }
  };

  const { workflow_runs: runs } = await get(`/repos/${repo}/actions/workflows/${workflow}/runs?status=completed&per_page=${Math.min(limit, 100)}`);
  const out = [];
  for (const run of runs) {
    // filter=all includes earlier attempts, which is how re-run flakiness shows up. A run
    // re-run twice has 3 jobs per package (93 for one CI run here), so read the jobs in
    // pages: smaller answers for GitHub to build, and none lost past the first 100.
    try {
      const jobs = [];
      for (let page = 1; ; page++) {
        const body = await get(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=${JOBS_PER_PAGE}&page=${page}`);
        jobs.push(...body.jobs);
        if (body.jobs.length < JOBS_PER_PAGE || jobs.length >= (body.total_count ?? 0)) break;
      }
      out.push(normalizeRun(run, jobs));
    } catch (err) {
      // One run GitHub can't serve right now shouldn't take the whole dashboard down
      // (it did, 2026-10-19: a 502 on one run's jobs, every build). Leave that run out,
      // say so in the log, and fail only if nothing could be read at all.
      if (!/returned 5\d\d/.test(String(err))) throw err;
      warn(`::warning::Left out CI run ${run.id}: ${err instanceof Error ? err.message : err} after ${ATTEMPTS} tries`);
    }
  }
  if (runs.length && !out.length) throw new Error('GitHub API failed for every run');
  return out;
}
