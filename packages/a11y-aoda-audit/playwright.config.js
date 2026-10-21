import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  use: { baseURL: 'http://127.0.0.1:4321', headless: true },
  webServer: {
    command: 'node src/server.js 4321',
    port: 4321,
    reuseExistingServer: !process.env.CI,
  },
  reporter: [['list']],
});
