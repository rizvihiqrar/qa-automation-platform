# flaky-test-analyzer

A small Node.js CLI that reads Playwright JSON reports from several CI runs and shows which tests are stable, which need retries, and which fail every time.

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
| smoketests.spec.js > Login lands on products page [chromium] | 3 | 0 | 3 | 0 | 100% | flaky |
| checkoutRegression.spec.js > Complete end-to-end checkout flow [chromium] | 3 | 3 | 0 | 0 | 0% | stable |
```

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
│   └── track.ts       # CLI used by the Flaky tests workflow
├── test/
│   ├── analyze.test.ts
│   ├── tracker.test.ts
│   └── github.test.ts
└── examples/demo-runs/   # Three real Playwright JSON reports
```

---

## Tests

```bash
npm test   # 23 tests, Node built-in test runner
```

The tests cover nested suites, the project name in each row, each label, skipped results, sorting, the Markdown output, every rule in the issue lifecycle table, and the API calls (paging, skipping pull requests, comment before close, error handling). Four deliberate breaks to the lifecycle rules (close after one clean run, close broken tests, touch manual issues, edit unchanged issues) each made a test fail.

---

## Limits

- It reads Playwright JSON only. Other frameworks need their own parser.
- It needs several runs to say much. One run can only show retries.
- It labels results. It doesn't explain them. Check timing, selectors, and shared state when a test stays flaky.
