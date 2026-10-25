import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:       './tests',
  timeout:       20000,
  workers:       4,
  fullyParallel: true,
  retries:       0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  use: {
    trace: 'retain-on-failure',
    extraHTTPHeaders: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  webServer: {
    command:              'node server/index.js',
    url:                  'http://localhost:4001/graphql',
    reuseExistingServer:  !process.env.CI,
    timeout:              10000,
  },
});
