# ai-test-generator

Turns a plain-English feature description into a Playwright test file using the Claude API, then **reviews the generated tests** before anyone commits them.

**In plain English:** An AI writes the first draft of a test from a description of a feature, and this tool checks the draft for the mistakes AI tends to make before a person accepts it. It also measures how often the drafts are good enough to use.

AI-generated tests are a draft. The reviewer catches the problems they most often have: tests with no assertions, fixed waits, CSS-class or XPath selectors, leftover markdown fences, `test.only`, and missing or duplicate `@smoke` tags.

---

## How It Works

```
feature description (.txt)
        │
        ▼
 buildPrompt()  ── rules: data-test selectors, one @smoke test, no fixed waits, an expect() in every test
        │
        ▼
 Claude API (claude-opus-5-5, refusal fallbacks on)
        │
        ▼
 cleanOutput()  ── strips a stray markdown fence
        │
        ▼
 reviewSpec()   ── flags weak tests; a failing review exits non-zero
        │
        ▼
 tests/generated/<feature>.spec.js
```

---

## Usage

```bash
npm install

# Generate tests (needs ANTHROPIC_API_KEY or an `ant auth login` profile)
npm run generate -- --input examples/input/feature-login.txt

# Review any spec file (no API call)
npm run review
node src/reviewCli.ts path/to/spec.js
```

`AI_MODEL` overrides the model (default `claude-opus-5-5`). The request asks for `high` effort and enables server-side refusal fallbacks. A refusal or a response cut off at `max_tokens` is reported as an error, not written to disk.

---

## Eval: how good are the generated tests?

The eval generates tests for the 10 feature descriptions in `examples/input/` and measures three things:

| Measure | Meaning |
|---|---|
| Review pass rate | Share of generated specs with no review errors |
| First-run pass rate | Share of generated tests that pass on the live site with **no retries** |
| Usable as-is | Share of specs with a clean review (no errors or warnings) where every test passed |

Each run also writes `FIXES.md`: one entry per spec that needed work, for a person to record the cause and the change. That file is the answer to "what did a human have to fix?"

```bash
npm run eval -- --generate --label run-1   # 10 paid API calls, then scoring
npm run eval -- --score eval/runs/run-1    # re-score saved specs, no API calls
```

Runs are saved in `eval/runs/<label>/`: the raw generated specs, `REPORT.md`, `results.json`, `FIXES.md`, and the Playwright JSON report.

**Cost:** one Claude API call per feature file, 10 per run. Most of the cost is output tokens; the run prints the output tokens for each feature. A run should cost a few dollars at most at Claude Opus 5.5 prices.

**From GitHub:** add the repository secret `ANTHROPIC_API_KEY`, then run the **AI generator eval** workflow from the Actions tab. It never runs automatically. The report appears in the job summary and the run folder is uploaded as an artifact.

### First run: claude-code-2026-10-16

Generated in a Claude Code session (not the paid API pipeline), in one pass, and scored as written. Details and the known bias are in the [run folder](eval/runs/claude-code-2026-10-16).

| Measure | Result |
|---|---|
| Specs that passed review | 10 of 10 (100%) |
| Generated tests that passed on the first run | 42 of 43 (98%) |
| Specs usable as-is | 9 of 10 (90%) |

The one failure was a navigation race: the test clicked a product, then checked a product-name selector that also matches the 6 names still on the list page. Waiting for the new URL wasn't enough, because the site changes the URL before it swaps the content; waiting for an element unique to the details page fixed it (passed 3 of 3 runs). That lesson is now a rule in the generator prompt. Full write-up in [FIXES.md](eval/runs/claude-code-2026-10-16/FIXES.md).

### Why the review step matters

While building the eval, a deliberately bad spec included a test with no assertion that clicked `.submit-button`. That class happens to exist on the login button, so the test **passed** its Playwright run while checking nothing. Only the review step flagged it. A pass/fail count alone would have scored it as a good test.

The feature descriptions only state behaviour verified on the live site (sort orders, error messages, checkout totals), so a failing generated test points at the generator, not the description.

---

## Tests

| Command | What runs | Count |
|---|---|---:|
| `npm test` | Unit tests for the prompt, the API call (with a fake client, no network), output cleanup, argument parsing, every review rule, the eval scoring, and the shard check | 38 |
| `npm run test:e2e` | The reviewed example spec, `examples/output/login.spec.js`, against the live Sauce Demo site | 4 |
| `npm run test:regression` | The Sauce Demo regression suite, `tests/regression/` (see below) | 43 |

The example spec was generated, then reviewed: the reviewer flagged a CSS class selector, which was changed to `[data-test="inventory-item"]`. The note is in the file header.

---

## Regression Suite, Sharded in CI

The 43 tests from the first eval run passed review, so they became the Sauce Demo regression suite in `tests/regression/`. They are unchanged except for the one fix recorded in [FIXES.md](eval/runs/claude-code-2026-10-16/FIXES.md). The eval run folder keeps the original output.

CI splits the suite across 3 runners:

1. Each `regression (shard N/3)` job runs `playwright test --shard=N/3 --reporter=blob` and uploads its blob report. `fullyParallel` lets a shard take single tests, not whole files, so the split comes out even (15/14/14).
2. The `regression report` job downloads every blob, merges them into one HTML report (artifact `report-regression`), and runs the shard check.

That is the full run, on main, nightly, and pull requests that change this package. Other pull requests run only the 10 `@smoke` tests on a single shard (`regression (shard 1/1)`); the shard check then lists with the same `--grep`, so it expects 10. Only full runs upload `regression-results` for the Flaky tests workflow, since a smoke run would look like 33 tests had gone missing.

### The shard check

`src/shardCheck.ts` compares `playwright test --list` with the merged report: every listed test must have run exactly once, and nothing unlisted may have run. It writes a table to the job summary and fails the job otherwise.

It exists because a merged report only shows what it was given, and neither failure below changes Playwright's exit code. Both were reproduced locally with real blob reports:

| What went wrong | What the merged report said | Shard check |
|---|---|---|
| One shard's report never reached the merge | 29 passed | Fails: 14 missing, each named |
| One shard's report merged twice | 58 passed | Fails: 15 ran more than once |

Tests are matched by file, describe and title, not by test ID: when `merge-reports` sees the same test in two blobs, it gives the second copy new IDs, so a check keyed on IDs would see 15 extra tests rather than duplicates. Retries don't count as duplicates; flaky and failed tests are listed but left to the shard jobs to fail on.

### Does sharding pay off here?

Measured on this PR's CI, one run each, so treat the numbers as rough (the browser install alone varied from 17 to 27 seconds between jobs):

| | 1 shard | 3 shards |
|---|---:|---:|
| Time to the last regression result | 53 s | 41 s |
| Test step | 16 s | 6–9 s per shard |
| Runner time used | 53 s | 110 s |

Three shards cut the wait by about 12 seconds and roughly doubled the runner time, because every shard repeats the ~25 seconds of checkout, `npm ci` and browser install. At 43 tests the suite is too small to need sharding; the setup is here so it scales when the suite grows. The rule of thumb from these numbers: add a shard only when it removes more test time than the ~25 seconds of setup it adds. The other browser jobs (multi-user-flow-patterns, bdd-playwright-demo, a11y-aoda-audit) spend 5–13 seconds testing and over 20 seconds installing a browser, so they stay as single jobs.

---

## Project Structure

```
├── src/
│   ├── generate.ts         # CLI: generate, write, then review
│   ├── generator.ts        # API call with an injectable client
│   ├── review.ts           # Review rules for generated specs
│   ├── reviewCli.ts        # CLI: review existing spec files
│   ├── eval.ts             # CLI: generate and score an eval run
│   ├── evalReport.ts       # Scoring, report, and fixes checklist
│   ├── shardCheck.ts       # Did every test run exactly once across shards?
│   ├── shardCheckCli.ts    # CLI: list.json + merged.json → table, exit code
│   └── prompts/testPrompt.ts
├── eval/
│   ├── playwright.eval.config.js   # One run, no retries
│   └── runs/<label>/               # Saved eval runs
├── examples/
│   ├── input/              # 10 feature descriptions
│   └── output/login.spec.js
├── tests/regression/       # 43 reviewed Sauce Demo tests, sharded in CI
├── playwright.regression.config.js
└── test/                   # Unit tests (node:test)
```

The tool is strict TypeScript, run directly by Node 24 with no build step. The generated specs stay JavaScript, because that is what the model is asked to write. The API client is typed through a small `MessagesClient` interface in `generator.ts`, so the tests' fake client is checked against the same shape the real SDK call uses.

---

## Limits

- The reviewer reads text, not a syntax tree. Braces inside string literals can confuse its test-body matching.
- Passing the review doesn't mean a test is correct. It means the obvious problems are gone; a person still checks the logic.
