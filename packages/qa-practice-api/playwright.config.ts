import { defineConfig } from '@playwright/test';
import { ADMIN } from './tests/admin.ts';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4000',
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
  webServer: {
    command: 'node src/server.ts',
    port: 4000,
    reuseExistingServer: !process.env.CI,
    env: { NODE_ENV: 'test', PORT: '4000', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password },
  },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    // Read by the traceability matrix (packages/ci-dashboard/src/traceability.js).
    ['json', { outputFile: 'reports/results.json' }],
    ['list'],
  ],
});
