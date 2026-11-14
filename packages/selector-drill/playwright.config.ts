import { defineConfig } from '@playwright/test';

// The drill sets its own page content, so there is no server and no base URL.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  use: { trace: 'retain-on-failure' },
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});
