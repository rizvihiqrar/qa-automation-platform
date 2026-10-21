import { defineConfig } from '@playwright/test';

// Only the label evidence runs in a browser; everything else is node:test.
export default defineConfig({
  testDir: 'evidence',
  retries: 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
