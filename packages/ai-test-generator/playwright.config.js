import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['examples/output/**/*.spec.js', 'tests/generated/**/*.spec.js'],
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
  },
  retries: process.env.CI ? 2 : 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  reporter: [['list']],
});
