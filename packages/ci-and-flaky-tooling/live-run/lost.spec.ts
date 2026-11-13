// 60 tiny checks for the live proof of the stop-lost-run reporter (npm run live-proof). They need no browser.
// MODE picks the story: healthy (all pass), broken (all fail, as after a bad deploy) or flaky (5 of the first 20 fail).
import { test, expect } from '@playwright/test';

const mode = process.env.MODE ?? 'healthy';
const flakyOnes = [3, 7, 11, 15, 19];

for (let n = 1; n <= 60; n += 1) {
  test(`check ${n}`, async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const shouldFail = mode === 'broken' || (mode === 'flaky' && flakyOnes.includes(n));
    expect(shouldFail, 'the environment answered').toBe(false);
  });
}
