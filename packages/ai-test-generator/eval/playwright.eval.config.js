// Runs the specs of one eval run. No retries: the eval measures whether a
// generated test passes the first time, not whether it eventually passes.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: process.env.EVAL_RUN_DIR,
  testMatch: '*.spec.js',
  timeout: 30000,
  retries: 0,
  workers: 2,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  reporter: [['json']],
});
