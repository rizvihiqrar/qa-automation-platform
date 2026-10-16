# ai-test-generator

Turns a plain-English feature description into a Playwright test file using the Claude API, then **reviews the generated tests** before anyone commits them.

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
node src/reviewCli.js path/to/spec.js
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
| `npm test` | Unit tests for the prompt, the API call (with a fake client, no network), output cleanup, argument parsing, every review rule, and the eval scoring | 28 |
| `npm run test:e2e` | The reviewed example spec, `examples/output/login.spec.js`, against the live Sauce Demo site | 4 |

The example spec was generated, then reviewed: the reviewer flagged a CSS class selector, which was changed to `[data-test="inventory-item"]`. The note is in the file header.

---

## Project Structure

```
├── src/
│   ├── generate.js         # CLI: generate, write, then review
│   ├── generator.js        # API call with an injectable client
│   ├── review.js           # Review rules for generated specs
│   ├── reviewCli.js        # CLI: review existing spec files
│   ├── eval.js             # CLI: generate and score an eval run
│   ├── evalReport.js       # Scoring, report, and fixes checklist
│   └── prompts/testPrompt.js
├── eval/
│   ├── playwright.eval.config.js   # One run, no retries
│   └── runs/<label>/               # Saved eval runs
├── examples/
│   ├── input/              # 10 feature descriptions
│   └── output/login.spec.js
└── test/                   # Unit tests (node:test)
```

---

## Limits

- The reviewer reads text, not a syntax tree. Braces inside string literals can confuse its test-body matching.
- Passing the review doesn't mean a test is correct. It means the obvious problems are gone; a person still checks the logic.
