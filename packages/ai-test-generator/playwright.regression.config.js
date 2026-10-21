// Sauce Demo regression suite: the 43 tests from the first eval run, promoted
// after review with the one fix recorded in FIXES.md. CI splits it across
// runners with --shard; fullyParallel lets a shard take single tests rather
// than whole files, so the shards come out even.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/regression',
  testMatch: '*.spec.js',
  fullyParallel: true,
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
  },
  // CI passes --reporter=blob so the shards can be merged into one report.
  reporter: [['list']],
});
