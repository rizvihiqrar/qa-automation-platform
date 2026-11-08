// Cypress sometimes can't start the browser on a CI runner: "The browser never connected.
// Something is wrong. The tests cannot run. Aborting..." (CI run 42467489172, 2026-11-08,
// Firefox 159: no test ran, then Cypress crashed in its own code). That is the runner, not the
// UI, so a run that ends like that is started once more. Anything else is never retried:
// a failing test fails the run the first time.

export const LAUNCH_ATTEMPTS = 2;
const NEVER_CONNECTED = 'The browser never connected';

export type CypressRun = { status: number | null; output: string };

/** True when the run died because the browser never connected (not because a test failed). */
export function browserNeverConnected(output: string): boolean {
  return output.includes(NEVER_CONNECTED);
}

/** Runs `run` again only while the browser never connected, up to LAUNCH_ATTEMPTS runs. */
export async function runWithLaunchRetry(run: () => Promise<CypressRun>, log: (line: string) => void = console.log): Promise<CypressRun> {
  let result = await run();
  for (let attempt = 1; attempt < LAUNCH_ATTEMPTS && result.status !== 0 && browserNeverConnected(result.output); attempt++) {
    log(`\nThe browser never connected (attempt ${attempt} of ${LAUNCH_ATTEMPTS}). Starting the run again.`);
    result = await run();
  }
  return result;
}
