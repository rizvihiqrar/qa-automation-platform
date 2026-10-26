import { defineConfig } from '@playwright/test';

// The banking UI on a frozen clock (src/serve.ts), screenshots compared with baselines kept in
// baselines/<platform>/<browser>/. Fonts and anti-aliasing differ between Windows, macOS and Linux, so
// only the Linux baselines (made on the CI runner, the machine that checks them) are committed.
// A run on another system works too: it makes its own baselines in a folder git ignores.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  snapshotPathTemplate: '{testDir}/../baselines/{platform}/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      // Playwright's default (0.2) is wide enough to miss a button a few shades off. 0.05 sees it;
      // tests/planted-bugs.spec.ts keeps both facts true.
      threshold: 0.05,
      maxDiffPixels: 0,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4400',
    viewport: { width: 1100, height: 800 },
    bypassCSP: true, // the planted bugs inject a style tag; the page's own policy would refuse it
    trace: 'retain-on-failure',
    actionTimeout: 10000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
  // Always a fresh server: a stale one on port 4400 would be screenshotted.
  webServer: { command: 'node src/serve.ts', url: 'http://127.0.0.1:4400/', reuseExistingServer: false },
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
});
