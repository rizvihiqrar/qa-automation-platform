import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: false,
  use: {
    trace: 'retain-on-failure',
    baseURL: process.env.BASE_URL || 'https://www.saucedemo.com',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
  },
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
});
