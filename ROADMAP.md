# Roadmap: 30 days, one module a day

Each day is one branch and one pull request, merged only when CI is green. The repo grows through real, reviewable commits rather than a single upload.

Status: ✅ done · 🔶 in progress · ⬜ planned

---

## Days 1–3: Consolidate (done 2026-10-16)

- ✅ Audit the 19 unpublished projects; keep 12 that back resume skills, add the 2 new tools, drop the rest
- ✅ Employer-data and secrets scan; copy keepers into `packages/` without old git history
- ✅ Fix every failing suite (BDD, contract, AI features, Postman) and add tests where there were none (ai-test-generator, test-data-factory)
- ✅ One root CI workflow: every package on push, pull request, and nightly
- ✅ README for every package; correct stale test counts

## Days 4–14: New modules

| Day | Module | Backs this resume line | Status |
|---:|---|---|---|
| 4 | **AI generator eval**: generate tests for 10 feature files; record the % that pass review, the % that pass a real run, and what a human had to fix | AI-assisted test generation, reviewing AI output | ✅ first run: 10/10 passed review, 42/43 tests passed first time, 9/10 usable as-is; the one fix became a prompt rule |
| 5 | **SQL data-integrity kit** on SQLite: orphan rows, duplicates, totals that don't reconcile | SQL, data integrity checks | ✅ 15 checks, 33 tests, each check proven by an injected defect |
| 6 | **Defect report linter**: required fields, repro steps, expected vs actual, severity | Defect reports, bug lifecycle | ✅ 13 rules, a score per report, Markdown and JSON input, 20 tests |
| 7 | **Webhook harness**: signature checks, retries, idempotency | Webhooks, REST APIs | ✅ signing, replay protection, once-only processing incl. concurrent duplicates, retry rules; 20 tests |
| 8 | **Log signature grouper**: group error logs by normalized signature | Log analysis, root cause | ✅ plain and JSON logs, stack traces kept together, new/grown/gone vs a baseline; 15 tests |
| 9 | **OpenAPI drift checker** against qa-practice-api | API testing, contract thinking | ✅ found and fixed 2 real API bugs (text price stored as null, negative stock); live check 20/20; 16 tests |
| 10 | **Exploratory session tracker**: charters, time boxes, findings report | Exploratory testing, QA documentation | ✅ charters, timeboxes, tagged notes, team debrief, session scaffolding; 10 tests |
| 11 | **k6 performance suite** with thresholds against qa-practice-api | Performance testing (re-add to resume only once this exists) | ✅ found event-loop blocking in password hashing; browsing p95 67 ms → 1 ms after the fix; thresholds now set from measurements |
| 12 | **Release gate**: block a deploy on smoke results; post a summary | CI/CD, production deployments | ✅ policy-based GO/NO-GO from smoke, contract and k6 results; Release workflow deploys (simulated) only on GO; 15 tests |
| 13 | **Accessibility** against a local UI, framed around AODA, with a findings report | Accessibility | ✅ before/after demo store; 9 issue types found and fixed; catches placeholder-only labels axe misses; 16 tests |
| 14 | **Results dashboard** wired to CI: pass rate, runtime, flake rate over time | Impact metrics | ✅ built from the Actions API after every CI run on main, published to GitHub Pages; 12 tests |

## Days 15–21: TypeScript

The resume leads with TypeScript, so convert one area a day, keeping CI green after each.

| Day | Scope | Status |
|---:|---|---|
| 15 | Shared `tsconfig`, type-check job in CI | ✅ `checkJs` over 8 packages, CI `typecheck` job; first pass fixed 2 unsafe `server.address()` uses; found that untyped JS calls aren't arity-checked |
| 16 | test-data-factory | ✅ strict TypeScript run by Node 24 type stripping (no build); typed User/Order/Product; CI on Node 24 |
| 17 | flaky-test-analyzer, worker-scaling-benchmark | ✅ typed Playwright report and benchmark models; strict index checks caught two empty-input bugs (median returned NaN, summarize crashed) |
| 18 | ai-test-generator | ✅ typed review findings, eval scoring and Playwright report; the API client is a small typed interface the fake test client also satisfies |
| 19 | qa-for-ai-features, qa-practice-api | ✅ typed store, routes and AI response contract. Found along the way: PUT /products skipped the create validation, orders oversold when one product was on two lines, a test timeout Playwright silently ignored, and a mock server that crashed on malformed JSON. All fixed with regression tests |
| 20 | multi-user-flow-patterns, bdd-playwright-demo | ✅ typed sessions, page objects and Cucumber World. Review found a logout assertion that matched every URL and a sort check too loose to fail; both tightened. Cucumber 11 to 13 for Node 24 |
| 21 | Every package under the type-check (23 of 23 with code) | ✅ sql-data-integrity moved to strict TypeScript, which surfaced a Windows bug: CRLF line endings made it reject every check file. The other tools and the CI demos are type-checked as JavaScript (`checkJs`); that pass found `test.each` tables whose expected column was never used. Converting the remaining tools to strict TypeScript is left as follow-up |

## Days 22–30: Pipeline depth and polish

| Day | Work | Status |
|---:|---|---|
| 22 | Shard the browser suites across runners | ✅ the 43 reviewed AI-generated tests became a Sauce Demo regression suite, split across 3 runners with blob reports merged into one HTML report. A shard check proves every test ran exactly once: a lost shard (29 passed) and a doubled one (58 passed) both look green in the merged report. Measured: 53 s → 41 s wall time for about twice the runner time, so the smaller browser suites stay unsharded |
| 23 | Feed nightly reports into flaky-test-analyzer; tag flaky tests | ✅ CI saves the merged regression results; a Flaky tests workflow analyzes the last 14 runs on main after each CI run and keeps one `flaky-test` issue per flaky test, opened with links to the unstable runs and closed after 5+ clean runs. Broken tests (fail every run) are kept apart from flaky ones |
| 24 | Split fast `@smoke` checks on pull requests from full nightly regression | ⬜ |
| 25 | Publish HTML reports to GitHub Pages | ⬜ |
| 26 | Architecture diagram and README pass for non-technical readers | ⬜ |
| 27 | Pick the two strongest results for the resume, with numbers | ⬜ |
| 28 | Update LinkedIn projects and the GitHub profile README | ⬜ |
| 29 | Archive or fold the remaining standalone repos | ⬜ |
| 30 | Retrospective; tag v1.0 | ⬜ |

---

## Rules for every day

- No employer code, names, URLs, or data.
- No `.env` files or keys in commits.
- Every module ships with tests and a README that states real, verified counts.
- If a public demo service changes and breaks a test, fix the test and record why in the package README.
