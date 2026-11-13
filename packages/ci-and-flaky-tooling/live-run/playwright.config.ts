import { defineConfig } from '@playwright/test';

// One worker, so the checks finish in order and the numbers in the proof are exact.
export default defineConfig({
  testDir: '.',
  testMatch: 'lost.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [['list'], ...(process.env.STOP === '1' ? [['./stop-lost-run.ts', { rate: 0.3, after: 20 }] as [string, object]] : [])],
});
