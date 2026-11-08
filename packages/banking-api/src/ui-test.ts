// Runs the Cypress UI tests, then the SQL ledger checks on the database they left.
//   node src/ui-test.ts --browser firefox      # any `cypress run` options
// cypress.config.ts starts the server on a fresh ui.db; every spec already ends with
// the checks (cypress/support/e2e.ts), and this runs them once more on the final file,
// so a run fails if the UI left a ledger that doesn't balance (BK-R30). Exit code 1
// if either part fails.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runWithLaunchRetry, type CypressRun } from './launch-retry.ts';

const cwd = fileURLToPath(new URL('..', import.meta.url));
// Set by VS Code's terminal (and some other Electron hosts); with it, Cypress's own
// Electron starts as plain Node and refuses its options.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Cypress's output goes through to the log as it comes, and is kept to see how the run ended.
// Piped output isn't a terminal, so colour is asked for when this one is.
function cypressRun(): Promise<CypressRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['node_modules/cypress/bin/cypress', 'run', ...process.argv.slice(2)], {
      cwd,
      env: process.stdout.isTTY ? { ...env, FORCE_COLOR: '1' } : env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';
    for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]] as const) {
      stream.setEncoding('utf8'); // a character split between two chunks stays whole
      stream.on('data', (text: string) => {
        output += text;
        out.write(text);
      });
    }
    child.on('error', (error) => resolve({ status: 1, output: `${output}\ncould not start Cypress: ${error.message}` }));
    child.on('close', (status) => resolve({ status, output }));
  });
}

// A browser that never connects (a runner problem, not a failing test) gets one more run.
const cypress = await runWithLaunchRetry(cypressRun);
console.log('\nSQL ledger checks on ui.db, the database the UI tests left:');
const check = spawnSync(process.execPath, ['src/check.ts', '--db', 'ui.db'], { cwd, stdio: 'inherit' });
process.exitCode = cypress.status === 0 && check.status === 0 ? 0 : 1;
