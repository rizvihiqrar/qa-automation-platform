import { defineConfig } from '@playwright/test';

// The browser checks run against a small local site (tests/fake-site.ts), never a real one:
// a test must not fail because somebody else's site is down. The monitor itself is what
// watches the real sites (.github/workflows/monitor.yml).
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  use: { trace: 'retain-on-failure' },
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});
