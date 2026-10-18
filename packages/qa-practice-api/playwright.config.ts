import { defineConfig } from '@playwright/test';
import { ADMIN } from './tests/admin.ts';

// Mutation testing runs several copies of the suite at once (stryker.config.mjs):
// each Stryker worker starts its own server on its own port.
const port = 4000 + Number(process.env.STRYKER_MUTATOR_WORKER ?? 0);

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: process.env.BASE_URL || `http://localhost:${port}`,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
  webServer: {
    command: 'node src/server.ts',
    port,
    reuseExistingServer: !process.env.CI,
    env: { NODE_ENV: 'test', PORT: String(port), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password },
  },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    // Read by the traceability matrix (packages/ci-dashboard/src/traceability.js).
    ['json', { outputFile: 'reports/results.json' }],
    ['list'],
  ],
});
