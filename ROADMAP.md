# Roadmap: 60 days, one module a day

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
| 24 | Split fast `@smoke` checks on pull requests from full nightly regression | ✅ pull requests run the 16 `@smoke` browser tests (of 65), main and nightly run all of them. A PR that changes a suite or the CI wiring, or has the `full-regression` label, still runs that suite in full, so a regression-only test can't merge untested. Found: `cucumber-js --tags` exits 0 when a tag matches nothing, so a mistyped smoke tag would pass while testing nothing; the BDD scripts now fail first. Measured: 75% fewer live-site test runs per PR, but no shorter wait (k6 is the slowest job either way) |
| 25 | Publish HTML reports to GitHub Pages | ✅ the 9 reports from each CI run on main are published next to the dashboard, with an index of CI results. Everything is scanned first: tokens in text are redacted, and a report whose zipped data holds one is withheld. The first scan found live access tokens in the Postman report (19 redacted) |
| 26 | Architecture diagram and README pass for non-technical readers | ✅ root README opens with a plain-English section, a "how a change gets tested" diagram and a glossary; the architecture diagram is redrawn (it predated sharding, smoke/full, flaky tracking and Pages reports) and split into two readable views, each checked by rendering it at GitHub's width; stale facts fixed (Node 24, TypeScript status); bugs table brought up to date (18 entries); every package README now has an "In plain English" line |
| 27 | Pick the two strongest results for the resume, with numbers | ✅ the k6 login-hashing bug (browsing p95 67–84 ms → 1 ms, logins 72 → 40 ms) and the reviewed AI test generator (10/10 specs passed review, 42/43 tests passed first run, review caught an assertion-free test Playwright passed). Both are in the root README's "Two results in numbers" with links to the evidence |
| 28 | Update LinkedIn projects and the GitHub profile README | ✅ profile README leads with this project and the two results in numbers, notes the archived suites, and condenses the build notes. LinkedIn left as it is by choice |
| 29 | Archive or fold the remaining standalone repos | ✅ accessibility-test-suite, playwright-demo-suite and api-test-suite archived (read-only, still public) with a notice pointing to the packages that replace them: a11y-aoda-audit, the Sauce Demo regression suite, and the API packages. cicd-pipeline-demo stays active for its GitHub Actions, GitLab CI and Azure DevOps pipelines. Nothing folded in, since each archived suite already has a stronger package here |
| 30 | Retrospective; tag v1.0 | ✅ [RETROSPECTIVE.md](RETROSPECTIVE.md): main lesson is that green is not proof (five checks passed while checking nothing), plus what v1.0 doesn't prove yet. Tagged v1.0.0 after the Release workflow's gate returned GO on main |

## Days 31–60: Phase 2

Days 1–30 ended at [v1.0.0](https://github.com/rizvihiqrar/qa-automation-platform/releases/tag/v1.0.0). Phase 2 covers what v1.0 doesn't show yet: test design and written analysis, testing AI-written code and AI output, a money-handling domain, mobile, and backend infrastructure. Same rules as before. Days marked 🤖 use model output generated in a Claude Code session and committed as a recorded run (as on Day 4), so CI never calls a paid API.

### Days 31–36: Test design and analysis

| Day | Work | Status |
|---:|---|---|
| 31 | Root-cause write-ups for five bugs already found: the k6 event-loop block, the webhook duplicate race, CRLF rejecting every SQL check, Cucumber passing on an unmatched tag, tokens in the published reports | ⬜ |
| 32 | Statistics for run-to-run variance: repeated runs, pass rates with confidence intervals, how many runs before calling a test flaky | ⬜ |
| 33 | Risk-based test strategy and test plan for qa-practice-api; cases designed with named techniques (equivalence partitioning, boundary values, decision tables, state transitions) | ⬜ |
| 34 | Generated traceability matrix: requirement → test cases → latest CI result, published with the reports | ⬜ |
| 35 | Requirement review log on the Day 4 feature files: ambiguities, missing acceptance criteria, and which ones became bugs | ⬜ |
| 36 | Security basics: authorization tests (other users' orders, missing role checks, rate limits) and an OWASP ZAP baseline scan in CI | ⬜ |

### Days 37–42: AI quality

| Day | Work | Status |
|---:|---|---|
| 37 | Validating AI-written code, part 1: spec and requirement review for discount codes; an AI writes the feature 🤖 | ⬜ |
| 38 | Part 2: code review, boundary and decision-table tests on the AI's code | ⬜ |
| 39 | Part 3: property-based tests (fast-check) and mutation testing; publish what the AI got wrong and which technique caught it | ⬜ |
| 40 | LLM-as-judge checked against human labels (DeepEval or promptfoo) 🤖 | ⬜ |
| 41 | Red-team suite for the AI feature: prompt injection, hallucination, refusals 🤖 | ⬜ |
| 42 | Langfuse tracing (self-hosted) linking each AI test to its trace | ⬜ |

### Days 43–48: Money handling and mobile

| Day | Work | Status |
|---:|---|---|
| 43 | Banking demo API: accounts, transfers, decimal money (no floats) | ⬜ |
| 44 | Idempotency keys; two concurrent transfers overdrawing an account | ⬜ |
| 45 | SQL ledger checks: every transfer balances | ⬜ |
| 46 | Cypress UI tests for a small banking UI | ⬜ |
| 47 | Azure DevOps pipeline run for real, results in Azure Test Plans | ⬜ |
| 48 | Mobile: Appium or WebdriverIO against a sample Android app on an emulator in CI | ⬜ |

### Days 49–54: Backend and infrastructure

| Day | Work | Status |
|---:|---|---|
| 49 | Docker and Testcontainers: qa-practice-api on real Postgres in CI | ⬜ |
| 50 | Event-driven backend: a queue between two services; ordering, retries, duplicates, dead-letter queue | ⬜ |
| 51 | Resilience: Toxiproxy injects latency, dropped connections and timeouts; tests prove retries and timeouts work | ⬜ |
| 52 | Observability: OpenTelemetry traces and metrics from qa-practice-api; tests assert on traces | ⬜ |
| 53 | Python: pytest + requests suite against qa-practice-api | ⬜ |
| 54 | Selenium side by side with Playwright on the same flows: setup, waits, flakiness, speed | ⬜ |

### Days 55–60: Automation and wrap-up

| Day | Work | Status |
|---:|---|---|
| 55 | MCP server for the platform: run a suite, list flaky-test issues, draft a triage note | ⬜ |
| 56 | n8n alerts on a failed nightly run or a new flaky-test issue | ⬜ |
| 57 | Synthetic monitoring: scheduled Playwright checks on public demo sites, uptime and response-time history on the dashboard | ⬜ |
| 58 | Run only the affected tests, selected from code coverage | ⬜ |
| 59 | Visual regression | ⬜ |
| 60 | Retrospective; tag v2.0 | ⬜ |

---

## Rules for every day

- No employer code, names, URLs, or data.
- No `.env` files or keys in commits.
- Every module ships with tests and a README that states real, verified counts.
- If a public demo service changes and breaks a test, fix the test and record why in the package README.
