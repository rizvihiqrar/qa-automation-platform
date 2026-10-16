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

export async function fetchRuns({ repo, token, workflow = 'ci.yml', limit = 40, fetchImpl = fetch }) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const get = async (path) => {
    const res = await fetchImpl(`https://api.github.com${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${path}`);
    return res.json();
  };

  const { workflow_runs: runs } = await get(`/repos/${repo}/actions/workflows/${workflow}/runs?status=completed&per_page=${Math.min(limit, 100)}`);
  const out = [];
  for (const run of runs) {
    // filter=all includes earlier attempts, which is how re-run flakiness shows up.
    const { jobs } = await get(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=100`);
    out.push(normalizeRun(run, jobs));
  }
  return out;
}
