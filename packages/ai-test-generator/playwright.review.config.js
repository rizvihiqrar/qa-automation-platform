// Tests written during the requirement review of the ten Day 4 feature files
// (docs/requirement-review). Each test ID RV-nn points at a finding in the log.
// Kept apart from tests/regression, which stays the unchanged AI-generated suite.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/review',
  testMatch: '*.spec.js',
  fullyParallel: true,
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
