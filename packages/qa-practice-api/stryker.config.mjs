// Mutation testing of the AI's discount code (Day 39 of docs/ai-written-code).
// Stryker changes the code one small way at a time (a mutant: `<` for `<=`, `true`
// for a condition, an emptied string…) and runs the tests; a mutant no test notices
// "survived", which points at a check the tests don't really make.
//
// MUTATION_TESTS picks the tests, so the techniques can be compared:
//   designed    the Playwright suite: the 126 designed cases and the 165 earlier tests
//   properties  the fast-check properties (tests/properties)
//   all         both (the default)
// Playwright has no Stryker runner, so the command runner runs the tests whole for
// each mutant; -x stops at the first failure. Each Stryker worker gets its own port
// (playwright.config.ts reads STRYKER_MUTATOR_WORKER).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const tests = process.env.MUTATION_TESTS ?? 'all';
const commands = {
  designed: 'npx playwright test -x --reporter=dot',
  properties: 'npm run test:properties',
  all: 'npm run test:properties && npx playwright test -x --reporter=dot',
};
if (!commands[tests]) throw new Error(`MUTATION_TESTS must be one of ${Object.keys(commands).join(', ')}`);
// Incremental mode: Stryker keeps each run's results and next time re-tests only the
// mutants whose code changed. It can't tell when the tests change, though: the
// command runner reports the whole run as one test, and Stryker then reuses every
// mutant whose own code is the same. So the results file is named after a hash of
// everything else that can change an outcome (the tests, the configs, the lockfile,
// and all source except the two files mutated in full). Change any of those and
// there is no earlier file, so the run is a full one. `--force` also forces one.
const FULLY_MUTATED = ['src/money.ts', 'src/routes/discounts.ts'];
function inputsHash(dir = '.') {
  const hash = createHash('sha256');
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.posix.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!FULLY_MUTATED.includes(p.replace(/^\.\//, ''))) hash.update(p).update(readFileSync(p, 'utf8').replaceAll('\r\n', '\n'));
    }
  };
  for (const entry of ['src', 'tests', 'playwright.config.ts', 'stryker.config.mjs', 'package-lock.json']) {
    const p = path.posix.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else hash.update(p).update(readFileSync(p, 'utf8').replaceAll('\r\n', '\n'));
  }
  return hash.digest('hex').slice(0, 12);
}

// Outside CI, Playwright reuses a server already on the port, which would test the
// unchanged code instead of the mutant. Stryker's workers inherit this.
process.env.CI ??= '1';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: commands[tests] },
  // The AI's code: all of discounts.ts and money.ts, and the part of POST /orders it
  // wrote (subtotal in cents through the amounts saved). Other order routes are older,
  // tested by older tests. scripts/ai-written-code.test.mjs checks the range still fits.
  mutate: ['src/money.ts', 'src/routes/discounts.ts', 'src/routes/orders.ts:74-104'],
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: `reports/mutation/${tests}.html` },
  jsonReporter: { fileName: `reports/mutation/${tests}.json` },
  // The Playwright set runs one mutant at a time. With three at once (each Stryker
  // worker starting its own server, each run using four Playwright workers) the
  // results were wrong both ways: a mutant that refuses every fixed-value code
  // "survived", and a harmless one was "killed". Run alone, both came out right,
  // matching the same changes made by hand. The properties start no server.
  concurrency: Number(process.env.MUTATION_CONCURRENCY ?? (tests === 'properties' ? 4 : 1)),
  timeoutMS: 60000,
  thresholds: { high: 90, low: 80, break: null },
  // Stryker rewrites tsconfig.json for a compile step through TypeScript's JS API,
  // which the repo's TypeScript 7 doesn't have. Node runs the .ts files directly,
  // so there is nothing to compile: a file name that doesn't exist skips that step.
  tsconfigFile: 'no-compile-step.json',
  incremental: true,
  incrementalFile: `reports/mutation/incremental/${tests}-${inputsHash()}.json`,
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
