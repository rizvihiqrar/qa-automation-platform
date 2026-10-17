import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, type FetchLike } from '../src/github.ts';

interface Call { method: string; url: string; body?: unknown }

// Records every request and answers from a queue of [status, json] responses.
function fakeFetch(responses: Array<[number, unknown]>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ method: init.method ?? 'GET', url, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
    const [status, json] = responses.shift() ?? [200, {}];
    return { ok: status < 300, status, json: async () => json };
  };
  return { calls, fetchImpl };
}

test('openIssues pages through the labelled issues and skips pull requests', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `t${i}`, body: null }));
  const { calls, fetchImpl } = fakeFetch([[200, page1], [200, [{ number: 200, title: 'pr', pull_request: {} }, { number: 201, title: 'x', body: 'b' }]]]);
  const issues = await client({ repo: 'o/r', token: 't', fetchImpl }).openIssues();
  assert.equal(issues.length, 101);
  assert.deepEqual(issues.at(-1), { number: 201, title: 'x', body: 'b' });
  assert.equal(issues[0]?.body, '');
  assert.match(calls[0]?.url ?? '', /repos\/o\/r\/issues\?state=open&labels=flaky-test&per_page=100&page=1$/);
  assert.match(calls[1]?.url ?? '', /page=2$/);
});

test('apply opens, updates, and comments before closing', async () => {
  const { calls, fetchImpl } = fakeFetch([]);
  await client({ repo: 'o/r', token: 't', fetchImpl }).apply([
    { kind: 'open', title: 'Flaky test: a', body: 'A' },
    { kind: 'update', number: 4, title: 'Flaky test: b', body: 'B' },
    { kind: 'close', number: 5, title: 'Flaky test: c', comment: 'done' },
  ]);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace('https://api.github.com/repos/o/r', '')}`), [
    'POST /issues', 'PATCH /issues/4', 'POST /issues/5/comments', 'PATCH /issues/5',
  ]);
  assert.deepEqual(calls[0]?.body, { title: 'Flaky test: a', body: 'A', labels: ['flaky-test'] });
  assert.deepEqual(calls[3]?.body, { state: 'closed', state_reason: 'completed' });
});

test('ensureLabel accepts "already exists", but other errors stop the run', async () => {
  await client({ repo: 'o/r', token: 't', fetchImpl: fakeFetch([[422, {}]]).fetchImpl }).ensureLabel();
  await assert.rejects(
    client({ repo: 'o/r', token: 't', fetchImpl: fakeFetch([[403, {}]]).fetchImpl }).apply([{ kind: 'open', title: 'x', body: 'y' }]),
    /GitHub API returned 403 for POST \/issues/,
  );
});
