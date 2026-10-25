import { defineConfig } from '@playwright/test';

// The quiz is a static page: no network, no account. Both browsers run every test.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  use: { trace: 'retain-on-failure', baseURL: 'http://127.0.0.1:4300', actionTimeout: 10000 },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
  webServer: { command: 'node src/serve-quiz.ts', url: 'http://127.0.0.1:4300/', reuseExistingServer: !process.env.CI },
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
});
