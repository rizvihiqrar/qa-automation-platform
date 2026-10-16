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

## What the Sample Shows

Four tests in the demo suite needed a retry in all three runs. A test that needs a retry every time is consistently unstable, so the retry is hiding a real problem. A flake rate that stays at 100% usually points to a timing or selector issue, not bad luck.

---

## Project Structure

```
├── src/
│   ├── analyze.ts     # Flattens reports, aggregates runs, labels each test
│   ├── report.ts      # Markdown table output
│   └── cli.ts         # Reads a folder of JSON reports
├── test/
│   └── analyze.test.ts
└── examples/demo-runs/   # Three real Playwright JSON reports
```

---

## Tests

```bash
npm test   # 8 tests, Node built-in test runner
```

The tests cover nested suites, the project name in each row, each label, skipped results, sorting, and the Markdown output.

---

## Limits

- It reads Playwright JSON only. Other frameworks need their own parser.
- It needs several runs to say much. One run can only show retries.
- It labels results. It doesn't explain them. Check timing, selectors, and shared state when a test stays flaky.
