// Cypress sometimes can't start the browser on a CI runner (CI run 42467489172, 2026-11-08,
// Firefox 159, two ways in one run). That is the runner, not the UI, so a run that ends like
// that is started once more. Anything else is never retried: a failing test fails the run the
// first time, and so does a run in which a test already failed before the browser gave out.
//  1. The first spec: "The browser never connected. Something is wrong. The tests cannot run.
//     Aborting..." and no test ran.
//  2. The relaunch for the next spec: Cypress crashed in its own code, "Cannot read properties of
//     undefined (reading 'browsingContextGetTree')" (connectToNewSpecBiDi, relaunchBrowser), with
//     no "never connected" in the output, so the first rule alone did not start the run again.

export const LAUNCH_ATTEMPTS = 2;

/** How a run looks when the browser could not be started or restarted: every pattern must match. Each entry was seen in a CI log. */
export const LAUNCH_FAILURES: { name: string; patterns: RegExp[] }[] = [
  { name: 'The browser never connected', patterns: [/The browser never connected/] },
  {
    name: 'Cypress crashed while relaunching the browser for the next spec',
    patterns: [/Cannot read properties of undefined \(reading 'browsingContext\w*'\)/, /relaunchBrowser|connectToNewSpecBiDi/],
  },
];

export type CypressRun = { status: number | null; output: string };

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** True when a spec in the output ran tests and one of them failed (a spec that never started shows "Tests: 0"). */
export function testFailed(output: string): boolean {
  const plain = output.replace(ANSI, '');
  return [...plain.matchAll(/Tests:\s+(\d+)[^\n]*\n(?:[^\n]*\n){0,3}?[^\n]*Failing:\s+(\d+)/g)].some(([, tests, failing]) => Number(tests) > 0 && Number(failing) > 0);
}

/** The name of the launch failure the output shows, or undefined (a failing test is not one, even with a launch failure after it). */
export function launchFailure(output: string): string | undefined {
  if (testFailed(output)) return undefined;
  return LAUNCH_FAILURES.find(({ patterns }) => patterns.every((p) => p.test(output)))?.name;
}

/** Runs `run` again only while the browser could not be started, up to LAUNCH_ATTEMPTS runs. */
export async function runWithLaunchRetry(run: () => Promise<CypressRun>, log: (line: string) => void = console.log): Promise<CypressRun> {
  let result = await run();
  for (let attempt = 1; attempt < LAUNCH_ATTEMPTS && result.status !== 0; attempt++) {
    const failure = launchFailure(result.output);
    if (!failure) break;
    log(`\n${failure} (attempt ${attempt} of ${LAUNCH_ATTEMPTS}). Starting the run again.`);
    result = await run();
  }
  return result;
}
