# A mistyped tag passed green

| | |
|---|---|
| **Where** | [bdd-playwright-demo](../../packages/bdd-playwright-demo), the `smoke` and `regression` scripts |
| **Found by** | Checking what a wrong tag does, while adding smoke runs to pull requests (Day 24) |
| **Impact** | A typo in a tag (`@smok`) would make every pull request's BDD check pass while running nothing. It never reached main |
| **Fixed in** | Day 24 (PR #22); the guard's own tests added on Day 31 |

## Symptom

```
$ npx cucumber-js --tags @smok
0 scenarios
0 steps
0m 0.791s (0m 0.000s executing your code)
$ echo $?
0
```

Zero scenarios, exit code 0. In CI that is a green check. Still the behaviour in Cucumber 13.

## How it was found

Day 24 made pull requests run only `@smoke` tests. Before relying on a tag filter to decide what runs, the obvious question is what happens when the filter is wrong. Playwright's `--grep` answers it safely: no matching tests is an error. Cucumber's `--tags` doesn't.

## Root cause

Not a bug in this repo's code, but an assumption: that a test runner fails when it runs nothing. Cucumber treats an empty selection as a successful run. Nothing in the pipeline checked that the smoke run actually ran anything.

**Why it matters:** this is the cheapest kind of false green. Nobody looks at a passing check, and a renamed or mistyped tag looks exactly like a passing suite.

## Fix

[scripts/require-scenarios.ts](../../packages/bdd-playwright-demo/scripts/require-scenarios.ts) loads the feature files with Cucumber's own API (`loadConfiguration`, `loadSources`) and exits 1 if the tag expression selects no scenarios. The `smoke` and `regression` scripts run it first:

```json
"smoke": "node scripts/require-scenarios.ts @smoke && cucumber-js --tags @smoke"
```

Using Cucumber's API, not a regex over the `.feature` files, means tag expressions (`@smoke and not @slow`) are read exactly as Cucumber reads them.

## Regression tests

- [`packages/bdd-playwright-demo/test/require-scenarios.test.ts`](../../packages/bdd-playwright-demo/test/require-scenarios.test.ts) › `a mistyped tag fails instead of running nothing`
- [`packages/bdd-playwright-demo/test/require-scenarios.test.ts`](../../packages/bdd-playwright-demo/test/require-scenarios.test.ts) › `a tag expression that excludes everything fails too`
- [`packages/bdd-playwright-demo/test/require-scenarios.test.ts`](../../packages/bdd-playwright-demo/test/require-scenarios.test.ts) › `a tag that selects scenarios passes and says how many`

**Found on Day 31:** the guard itself had no test. It was proven by hand once on Day 24, and nothing would notice if it stopped working. These 4 tests now run first in the BDD CI job (`npm run test:guard`). Put back: with the guard's `exit(1)` removed, `@smok` exits 0 again and 2 of the 4 tests fail.

## Prevention

- **A filter that decides what runs needs a check that it ran something.** The Day 22 shard check (every test ran exactly once) is the same idea for sharding.
- **A guard is code, so it gets a test.** This one stayed untested for a week; the gap was only visible by asking "what fails if this breaks?"
- **Not covered:** a tag that matches the wrong scenarios (say `@smoke` added to a slow test) still passes. The guard checks for zero, not for the right set.
