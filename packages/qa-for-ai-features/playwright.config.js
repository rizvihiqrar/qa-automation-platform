import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 15000,
  fullyParallel: false,
  use: {
    actionTimeout: 10000,
  },
  retries: 0,
  // One mock server for the whole run. Starting it per spec file made parallel
  // workers race for port 3031 (EADDRINUSE).
  webServer: {
    command: 'node mocks/aiServer.js',
    port: 3031,
    reuseExistingServer: !process.env.CI,
  },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
});
