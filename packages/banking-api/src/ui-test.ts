// Runs the Cypress UI tests, then the SQL ledger checks on the database they left.
//   node src/ui-test.ts --browser firefox      # any `cypress run` options
// cypress.config.ts starts the server on a fresh ui.db; every spec already ends with
// the checks (cypress/support/e2e.ts), and this runs them once more on the final file,
// so a run fails if the UI left a ledger that doesn't balance (BK-R30). Exit code 1
// if either part fails.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
// Set by VS Code's terminal (and some other Electron hosts); with it, Cypress's own
// Electron starts as plain Node and refuses its options.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const cypress = spawnSync(process.execPath, ['node_modules/cypress/bin/cypress', 'run', ...process.argv.slice(2)], { cwd, env, stdio: 'inherit' });
console.log('\nSQL ledger checks on ui.db, the database the UI tests left:');
const check = spawnSync(process.execPath, ['src/check.ts', '--db', 'ui.db'], { cwd, stdio: 'inherit' });
process.exitCode = cypress.status === 0 && check.status === 0 ? 0 : 1;
