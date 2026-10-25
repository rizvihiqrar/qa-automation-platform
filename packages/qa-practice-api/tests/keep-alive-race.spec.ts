import { test, expect } from '@playwright/test';

// TEMPORARY diagnosis for the DC-ST-06 "socket hang up" (removed in the fix commit).
// Ten parallel requests fill the pool with ten sockets, they sit idle for about the
// server's close time (6 s), then ten more parallel requests reuse them.

test('ten pooled sockets reused after about 6 s idle all get answers', async ({ request }) => {
  test.setTimeout(120000);
  const failures: string[] = [];
  for (let wait = 5980; wait <= 6020; wait += 4) {
    await Promise.all(Array.from({ length: 10 }, () => request.get('/health')));
    await new Promise((r) => setTimeout(r, wait));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => request.get('/health')));
    for (const r of results) {
      if (r.status === 'rejected') failures.push(`${wait} ms idle: ${String(r.reason).split('\n')[0]}`);
    }
  }
  console.log(failures.length ? failures.join('\n') : 'no hang-ups');
  expect(failures).toEqual([]);
});
