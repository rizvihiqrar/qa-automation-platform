import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: false,
  use: {
    baseURL: process.env.BASE_URL || 'https://www.saucedemo.com',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
  },
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
});
