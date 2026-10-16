import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:       './tests',
  timeout:       20000,
  workers:       4,
  fullyParallel: true,
  retries:       0,
  use: {
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
