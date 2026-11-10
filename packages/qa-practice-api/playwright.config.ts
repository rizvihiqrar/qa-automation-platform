import { defineConfig } from '@playwright/test';
import { ADMIN } from './tests/admin.ts';
import { receiverPort } from './tests/telemetry.ts';

// Mutation testing runs several copies of the suite at once (stryker.config.mjs):
// each Stryker worker starts its own server on its own port.
const port = 4000 + Number(process.env.STRYKER_MUTATOR_WORKER ?? 0);

// Set by scripts/with-postgres.ts (npm run test:postgres): the server uses Postgres
// instead of its in-memory store, and the Postgres-only tests in tests/postgres run.
const { DATABASE_URL, COLLECTOR_URL } = process.env;

export default defineConfig({
  testDir: './tests',
  // Anchored to this package's tests folder: a plain 'postgres/**' also matched a
  // checkout path with a folder named postgres in it, and skipped every test.
  testIgnore: [
    ...(DATABASE_URL ? [] : [/[\\/]tests[\\/]postgres[\\/]/]),
    // Set by scripts/with-collector.ts (npm run test:collector), which starts the
    // Docker pipeline these tests read.
    ...(COLLECTOR_URL ? [] : [/[\\/]tests[\\/]collector[\\/]/]),
  ],
  failOnFlakyTests: !!process.env.CI, // a test that passes only on a retry fails the CI job
  timeout: 30000,
  fullyParallel: true,
  globalSetup: './tests/global-setup.ts',
  use: {
    trace: 'retain-on-failure',
    baseURL: process.env.BASE_URL || `http://localhost:${port}`,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
  webServer: [{
    // Receives the API's traces and metrics (tests/telemetry.spec.ts), started first.
    command: `node scripts/otlp-receiver.ts ${receiverPort}`,
    url: `http://localhost:${receiverPort}/health`,
    reuseExistingServer: !process.env.CI,
  }, {
    command: 'node src/server.ts',
    port,
    // Never reuse a server already running on the port when testing Postgres (it
    // could be an in-memory one) or the Collector (it could send to the test receiver).
    reuseExistingServer: !process.env.CI && !DATABASE_URL && !COLLECTOR_URL,
    env: {
      NODE_ENV: 'test', PORT: String(port), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      ...(DATABASE_URL ? { DATABASE_URL } : {}),
      // OpenTelemetry (src/telemetry.ts): send to the receiver above (or to the Docker
      // Collector, npm run test:collector), every 50 ms for spans and logs and 200 ms
      // for metrics, so the tests don't wait long.
      OTEL_EXPORTER_OTLP_ENDPOINT: COLLECTOR_URL ?? `http://localhost:${receiverPort}`,
      OTEL_BSP_SCHEDULE_DELAY: '50',
      OTEL_METRIC_EXPORT_INTERVAL: '200',
      OTEL_BLRP_SCHEDULE_DELAY: '50',
    },
  }],
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    // Read by the traceability matrix (packages/ci-dashboard/src/traceability.js).
    ['json', { outputFile: 'reports/results.json' }],
    ['list'],
  ],
});
