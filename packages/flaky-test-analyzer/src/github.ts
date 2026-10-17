// Applies an issue plan through the GitHub REST API. Needs a token with
// issues: write. fetch is injectable so tests run without the network.
import { LABEL, type Issue, type IssueAction } from './tracker.ts';

export type FetchLike = (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface GitHubOptions {
  repo: string;
  token: string;
  fetchImpl?: FetchLike;
}

interface ApiIssue { number: number; title: string; body?: string | null; pull_request?: unknown }

export function client({ repo, token, fetchImpl = fetch }: GitHubOptions) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
  };
  const call = async (method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<unknown> => {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok && !okStatuses.includes(res.status)) throw new Error(`GitHub API returned ${res.status} for ${method} ${path}`);
    return res.json();
  };

  return {
    // Open issues with the label. The issues API also returns pull requests; skip those.
    async openIssues(): Promise<Issue[]> {
      const out: Issue[] = [];
      for (let page = 1; ; page++) {
        const batch = (await call('GET', `/issues?state=open&labels=${LABEL}&per_page=100&page=${page}`)) as ApiIssue[];
        for (const i of batch) if (!i.pull_request) out.push({ number: i.number, title: i.title, body: i.body ?? '' });
        if (batch.length < 100) return out;
      }
    },

    // Creates the label on first use; 422 means it already exists.
    async ensureLabel(): Promise<void> {
      await call('POST', '/labels', { name: LABEL, color: 'd93f0b', description: 'Opened and closed by the Flaky tests workflow' }, [422]);
    },

    async apply(actions: readonly IssueAction[]): Promise<void> {
      for (const a of actions) {
        if (a.kind === 'open') await call('POST', '/issues', { title: a.title, body: a.body, labels: [LABEL] });
        else if (a.kind === 'update') await call('PATCH', `/issues/${a.number}`, { body: a.body });
        else {
          await call('POST', `/issues/${a.number}/comments`, { body: a.comment });
          await call('PATCH', `/issues/${a.number}`, { state: 'closed', state_reason: 'completed' });
        }
      }
    },
  };
}
