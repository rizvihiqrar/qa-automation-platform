# flaky-test-analyzer

A small Node.js CLI that reads Playwright JSON reports from several CI runs and shows which tests are stable, which need retries, and which fail every time.

**In plain English:** Some tests pass or fail at random, and that makes people stop trusting test results. This tool looks across many runs to find those tests and opens a ticket for each one, so they get fixed instead of ignored.

Playwright's retry feature turns a flaky test green, so the test looks fine in the final report. This tool shows the retries, so you can see the tests that keep needing them.

No dependencies. Written in TypeScript; requires Node 24 or later (it runs the `.ts` files directly).

---

## Usage

Save one JSON report per run, then point the tool at the folder:

```bash
# Playwright config or CLI: write the JSON report for each run
npx playwright test --reporter=json   # or set PLAYWRIGHT_JSON_OUTPUT_NAME per run

node src/cli.ts path/to/reports
```

The output is a Markdown table, which you can paste into a PR comment or a README:

```
Analyzed 3 run(s), 16 test(s)

| Test | Runs | Passed | Needed retry | Failed | Flake rate | Status |
|---|---:|---:|---:|---:|---:|---|
| smoketests.spec.js > Smoke Tests > Login lands on products page [chromium] | 3 | 0 | 3 | 0 | 100% | flaky |
| checkoutRegression.spec.js > Checkout Regression > Complete end-to-end checkout flow [chromium] | 3 | 3 | 0 | 0 | 0% | stable |
```

Each test is named `file > describe blocks > title [project]`, so two tests with the same title in different `describe` blocks are counted separately.

Sample output from a real run of [playwright-demo-suite](https://github.com/rizvihiqrar/playwright-demo-suite) against the public Sauce Demo site is in `examples/demo-runs/`.

---

## How Tests Are Labelled

| Label | Meaning |
|---|---|
| `stable` | Same result in every run, with no retries |
| `flaky` | Needed a retry in at least one run, or passed in some runs and failed in others |
| `failing` | Failed in every run |

**Flake rate** is the share of runs where the test needed a retry or failed while passing elsewhere. Skipped results are ignored.

---

## Tracking Flaky Tests in CI

The **Flaky tests** workflow (`.github/workflows/flaky.yml`) runs this tool after every CI run on main, including the nightly one:

1. CI saves the merged results of the Sauce Demo regression suite (43 tests, 3 shards) as the `regression-results` artifact.
2. The workflow downloads that artifact from the last 14 CI runs on main, one folder per run.
3. `src/track.ts` analyzes them, writes `flaky-tests.json` (uploaded as an artifact), and keeps one GitHub issue per flaky test, labelled `flaky-test`. The job summary shows the table and every issue change.

| Situation | What happens to the issue |
|---|---|
| A test needed a retry, or failed between passes | Opened, with the counts and a link to each unstable run |
| Still flaky | Body refreshed with the latest counts (no edit if nothing changed) |
| Passed first time in every analyzed run, and ran at least 5 times | Closed with a comment; a new flake opens a new issue |
| Now fails in every run | Kept open and marked as broken, not flaky |
| Not found in any of the last runs (renamed or removed) | Closed, once there are at least 5 runs of history |
| Labelled `flaky-test` but opened by a person | Left alone |

Issues rather than a committed list: workflows in this repo aren't allowed to open pull requests, and an issue is where someone would discuss and fix the test anyway. Flaky tests are tracked, not skipped. Quarantining them would hide the signal this tool exists to show.

Try it without changing anything (no token needed):

```bash
# runs/<run-id>/merged.json, one folder per CI run
node src/track.ts runs --out flaky-tests.json
node src/track.ts runs --repo owner/name --apply   # needs GITHUB_TOKEN with issues: write
```

The lifecycle rules are pure functions in `src/tracker.ts`. `src/github.ts` applies them through the REST API and is tested with a fake `fetch`.

---

## How Sure Are We? Run-to-Run Variance

A test that never failed in 10 runs might still fail 1 run in 5. `src/variance-cli.ts` puts a number on that: each test's first-try pass rate with a 95% confidence interval, and what the clean runs do and don't rule out.

```bash
# One report, every test run N times with no retries
npx playwright test --repeat-each=59 --retries=0 --reporter=json > repeat.json
node src/variance-cli.ts repeat.json --window 14

# Or a folder with one report per CI run
node src/variance-cli.ts runs/
```

The **Variance** workflow (`.github/workflows/variance.yml`, run by hand) does the same on GitHub's runners: the regression suite, each test repeated N times across 3 shards, results in the job summary.

### The three numbers behind it

| Question | Answer | Where |
|---|---|---|
| A test passed 9 of 10 runs. What's its real pass rate? | Somewhere in 59.6%–98.2% (95% CI) | `wilson()` |
| A test passed all 14 runs. Can it still be flaky? | Yes: anything up to 19% failures fits that result | `zeroFailureUpperBound()` |
| How many runs to catch a test that fails 1 run in 20? | 59 for a 95% chance of seeing one failure | `runsToDetect()` |

| Test fails 1 run in | Runs for a 95% chance of seeing it fail | Chance it passes all 14 runs anyway |
|---:|---:|---:|
| 100 | 299 | 86.9% |
| 50 | 149 | 75.4% |
| 20 | 59 | 48.8% |
| 10 | 29 | 22.9% |
| 5 | 14 | 4.4% |

The flaky-test workflow looks at 14 CI runs. That window is good at catching a test that fails 1 run in 5, and close to blind to one that fails 1 run in 100. A closed flaky-test issue means "no longer flaky often", which is why the close comment now says so with a number.

**Why Wilson, not the textbook interval:** the textbook p ± 1.96·√(p(1−p)/n) collapses to a zero-width range when every run passes, which is the usual case for a test suite. In a simulation of a test with a 99% pass rate over 50 runs, it contained the true rate only 40% of the time; Wilson's interval did 91% (the test file runs this simulation with a fixed seed).

**One flake is proof:** a pass and a failure on the same code show the test is flaky, however rare. Statistics only matter for tests that never failed: they tell you how much "never" is worth.

### Measured on the regression suite

The 43-test Sauce Demo regression suite, run on a laptop against the live site with no retries:

| Run | Runs of each test | Test runs | Failures | Each test's failure rate is below (95%) |
|---|---:|---:|---:|---:|
| `--repeat-each=10` | 10 | 430 | 0 | 25.9% |
| `--repeat-each=59` (12.5 min, 4 workers) | 59 | 2,537 | 0 | 5.0% |
| Variance workflow on GitHub's runners, 59 repeats ([run](https://github.com/rizvihiqrar/qa-automation-platform/actions/runs/39055503120), ~6 min over 3 shards) | 59 | 2,537 | 0 | 5.0% |
| Both 59× runs together | 118 | 5,074 | 0 | 2.5% |

No failure in 5,074 runs, on a laptop and on CI runners. (Adding the two runs together assumes each test fails at about the same rate in both places.) What that supports: no test in this suite fails as often as 1 run in 20. What it doesn't: that they never fail. A test failing 1 run in 100 would pass all 59 runs 55% of the time. Full output: [examples/variance/regression-59x-local.md](examples/variance/regression-59x-local.md).

---

## What the Sample Shows

Four tests in the demo suite needed a retry in all three runs. A test that needs a retry every time is consistently unstable, so the retry is hiding a real problem. A flake rate that stays at 100% usually points to a timing or selector issue, not bad luck.

---

## Project Structure

```
├── src/
│   ├── analyze.ts     # Flattens reports, aggregates runs, labels each test
│   ├── report.ts      # Markdown table output
│   ├── cli.ts         # Reads a folder of JSON reports
│   ├── tracker.ts     # Flaky list and issue lifecycle (pure)
│   ├── github.ts      # Applies issue changes via the REST API
│   ├── track.ts       # CLI used by the Flaky tests workflow
│   ├── stats.ts       # Wilson interval, zero-failure bound, runs to detect
│   ├── variance.ts    # Pass rate and interval per test, Markdown (pure)
│   └── variance-cli.ts # CLI used by the Variance workflow
├── test/
│   ├── analyze.test.ts
│   ├── tracker.test.ts
│   ├── github.test.ts
│   ├── stats.test.ts
│   └── variance.test.ts
└── examples/demo-runs/   # Three real Playwright JSON reports
```

---

## Tests

```bash
npm test   # 37 tests, Node built-in test runner
```

The tests cover nested suites, the project name in each row, each label, skipped results, sorting, the Markdown output, every rule in the issue lifecycle table, and the API calls (paging, skipping pull requests, comment before close, error handling). Four deliberate breaks to the lifecycle rules (close after one clean run, close broken tests, touch manual issues, edit unchanged issues) each made a test fail.

The statistics are checked against published values (Wilson 0/10, 5/10, 9/10), against each other (`runsToDetect` and `zeroFailureUpperBound` are the same rule read both ways), and by seeded simulation (interval coverage; a 1-in-10 flaky test passing 14 runs in a row about 23% of the time). Seven deliberate breaks (a dropped term in the Wilson formula, rounding instead of rounding up, the rule of three instead of the exact bound, a too-wide interval, quoting the strongest claim instead of the weakest, not counting retries as failures, test IDs without describe titles) each made tests fail.

---

## Limits

- It reads Playwright JSON only. Other frameworks need their own parser.
- It needs several runs to say much. One run can only show retries.
- It labels results. It doesn't explain them. Check timing, selectors, and shared state when a test stays flaky.
- `--repeat-each` runs all happen minutes apart on one machine. They measure flakiness from timing and test isolation, not from a slow day on the site or a different runner, so repeated runs and CI history answer slightly different questions.
- The intervals assume each run is independent of the others. A site outage fails many tests at once; read a cluster of failures in one run as one event, not many.
