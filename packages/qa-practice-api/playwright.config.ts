import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4000',
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
  webServer: {
    command: 'node src/server.ts',
    port: 4000,
    reuseExistingServer: !process.env.CI,
    env: { NODE_ENV: 'test', PORT: '4000' },
  },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
});
