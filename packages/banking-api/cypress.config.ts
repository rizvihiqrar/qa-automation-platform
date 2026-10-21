import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { defineConfig } from 'cypress';
import { spawnServers } from './src/servers.ts';

// One fresh ledger file per run, served by a real `node src/server.ts` (the same
// process the race tests start). Tests never share accounts: each opens its own, so
// none depends on another's money. The file is kept after the run, so the SQL ledger
// checks can be run on everything the UI did (`npm run check -- --db ui.db`).
const DB = 'ui.db';

export default defineConfig({
  e2e: {
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    screenshotsFolder: 'reports/cypress/screenshots',
    videosFolder: 'reports/cypress/videos',
    video: true, // kept only for specs with a failure (after:spec below)
    retries: 0, // a flaky UI test should fail, not pass on a second try
    viewportWidth: 1100,
    viewportHeight: 800,
    async setupNodeEvents(on, config) {
      for (const file of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) rmSync(file, { force: true });
      const running = await spawnServers(1, DB, { SCREENING_DELAY_MS: process.env.SCREENING_DELAY_MS ?? '0' });
      process.once('exit', () => void running.stop());
      on('after:run', () => running.stop());

      on('after:spec', (_spec, results) => {
        const failed = results?.tests?.some((t) => t.state === 'failed');
        if (results?.video && !failed) rmSync(results.video, { force: true });
      });

      on('task', {
        // The 14 SQL ledger checks on the file the run is writing (BK-R30): exit 0 or a failure.
        ledgerChecks() {
          const run = spawnSync(process.execPath, ['src/check.ts', '--db', DB], { encoding: 'utf8' });
          return { code: run.status, output: `${run.stdout}${run.stderr}` };
        },
      });

      config.baseUrl = running.bases[0]!;
      return config;
    },
  },
});
