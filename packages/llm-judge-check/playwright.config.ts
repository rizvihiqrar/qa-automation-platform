import { defineConfig } from '@playwright/test';

// Only the label evidence runs in a browser; everything else is node:test.
export default defineConfig({
  testDir: 'evidence',
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
