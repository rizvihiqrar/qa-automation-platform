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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The API sometimes answers 502/503/504 for a heavy jobs query (filter=all on a run with
 * ~90 job attempts) and then succeeds a few seconds later, so 5xx and network errors are
 * retried with backoff. 4xx means the request itself is wrong and fails at once.
 * @param {{ repo: string, token?: string, workflow?: string, limit?: number, fetchImpl?: FetchLike,
 *   retries?: number, retryDelayMs?: number, sleep?: (ms: number) => Promise<void>, warn?: (msg: string) => void }} options
 */
export async function fetchRuns({
  repo, token, workflow = 'ci.yml', limit = 40, fetchImpl = fetch,
  retries = 3, retryDelayMs = 2000, sleep = wait, warn = console.warn,
}) {
  /** @type {Record<string, string>} */
  const headers = { Accept:'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const get = async (path) => {
    for (let attempt = 0; ; attempt++) {
      let error;
      try {
        const res = await fetchImpl(`https://api.github.com${path}`, { headers });
        if (res.ok) return res.json();
        error = new Error(`GitHub API returned ${res.status} for ${path}`);
        error.transient = (res.status ?? 0) >= 500;
      } catch (err) {
        error = err;
        error.transient = true; // network error: no response at all
      }
      if (!error.transient || attempt >= retries) throw error;
      await sleep(retryDelayMs * 2 ** attempt);
    }
  };

  const { workflow_runs: runs } = await get(`/repos/${repo}/actions/workflows/${workflow}/runs?status=completed&per_page=${Math.min(limit, 100)}`);
  const out = [];
  for (const run of runs) {
    // filter=all includes earlier attempts, which is how re-run flakiness shows up.
    // One run's jobs still failing with 5xx after retries drops that run, not the whole
    // dashboard. A 4xx (bad token, rate limit) would hit every run, so it still fails.
    try {
      const { jobs } = await get(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=100`);
      out.push(normalizeRun(run, jobs));
    } catch (err) {
      if (!err.transient) throw err;
      warn(`skipping run ${run.id}: ${err.message}`);
    }
  }
  return out;
}
