import { defineConfig } from '@playwright/test';

// No server and no base URL: every probe sets its own page content.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  use: { trace: 'retain-on-failure', locale: 'en-CA' },
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
