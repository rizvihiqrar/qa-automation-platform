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
| 31 | Root-cause write-ups for five bugs already found: the k6 event-loop block, the webhook duplicate race, CRLF rejecting every SQL check, Cucumber passing on an unmatched tag, tokens in the published reports | ✅ [docs/rca](docs/rca/README.md): five write-ups, each regression test re-checked by putting the bug back. That found two new bugs and two gaps: the webhook sender gave up on `409` and could lose an event (fixed, end-to-end test); the Postman CI artifact still held 19 live tokens (now 0); the Cucumber tag guard had no test (4 added); the hashing bug was only guarded by a k6 run (a 1-second event-loop test added, 0–11% busy fixed vs 100% for both old versions). A root test keeps the write-ups honest: sections, links, and every named test still existing |
| 32 | Statistics for run-to-run variance: repeated runs, pass rates with confidence intervals, how many runs before calling a test flaky | ✅ flaky-test-analyzer gained `stats.ts` (Wilson interval, zero-failure bound, runs to detect) and `variance-cli.ts`, plus a manual Variance workflow that repeats the regression suite on GitHub's runners. Measured locally and again on GitHub's runners: 2,537 runs each (59 per test, no retries), 0 failures, so each test fails less than 1 run in 20 (95% confidence), and no more than that. The 14-run flaky window catches a 1-in-5 flake 96% of the time but a 1-in-100 flake only 13%; issue bodies and close comments now say what the runs prove. Found: test names dropped `describe` titles, which would merge same-named tests (fixed). 23 → 37 tests, 7 deliberate breaks each caught |
| 33 | Risk-based test strategy and test plan for qa-practice-api; cases designed with named techniques (equivalence partitioning, boundary values, decision tables, state transitions) | ✅ [docs/test-strategy](docs/test-strategy/README.md): 18 risks scored by likelihood × impact (11 high: 5 found and fixed today, 1 already covered, 5 scheduled for Day 36), 12 requirements, and 85 designed cases, each tagged with its technique and requirement. The cases found 9 defects the existing 38 tests missed: any order status could be set from any other and cancelling kept the stock, a user could take another account's email, `""` and `true` were stored as prices, quantity 1.5 and `"2"` + `"3"` were mishandled, a `null` order line crashed the route, malformed bodies got HTML errors, and `limit=0` fell back to 10. All fixed; 41 of the 85 cases fail on the old code. A root test keeps the plan, the strategy and the tests in step (6 deliberate breaks, each caught) |
| 34 | Generated traceability matrix: requirement → test cases → latest CI result, published with the reports | ✅ [live matrix](https://rizvihiqrar.github.io/qa-automation-platform/reports/traceability/), rebuilt after every CI run on main from the test plan and qa-practice-api's JSON results: each of the 12 requirements with its risks, its cases and their results. A requirement passes only if every one of its cases passed; a missing result makes it incomplete, not passing. Checked by putting two fixed bugs back: 12/12 → 9/12, naming the three broken rules and the exact failing cases, while the 38 older route tests stayed green. The plan check and the matrix share one parser. 13 tests, 6 deliberate breaks each caught |
| 35 | Requirement review log on the Day 4 feature files: ambiguities, missing acceptance criteria, and which ones became bugs | ✅ [docs/requirement-review](docs/requirement-review/README.md): all 43 acceptance criteria read for what they leave out and checked against the live shop, 29 findings. 8 are defects in the demo shop, each with a test marked as an expected failure (an item total printed as `$119.94999999999999` for 6 of the 63 possible carts, a reset that leaves "Remove" buttons, a cart shared between users, an empty cart that can be ordered); 5 are AI-written tests that check less than their criterion says ("any sort" tried once, "at least one product" passes with one of six); 13 are rules now written down and tested; 3 are questions only the owner can answer, left without a test. 42 new tests in `ai-test-generator/tests/review`, stable over 210 runs, plus a root test that keeps the log word-for-word in step with the feature files and the tests (10 deliberate breaks, each caught) |
| 36 | Security basics: authorization tests (other users' orders, missing role checks, rate limits) and an OWASP ZAP baseline scan in CI | ✅ An admin can now be seeded (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), closing the Day 33 testability gap, and an [access-control matrix](docs/test-strategy/test-plan.md#access-control) tries every protected action as no one, a customer on their own data, a customer on someone else's, the admin, and a deleted account. With sign-in limit cases, 34 new designed cases (119 in all) found 7 defects: any customer could reprice or delete any product, list every account's email, read any account and mark their own order delivered; a deleted account's token kept working; sign-in had no limit; and with no `JWT_SECRET` set, tokens were signed with a secret written in this repository, so anyone could sign an admin token. All fixed, and each fix checked by putting the bug back (a limit that counted only finished failures let all 20 simultaneous guesses through; only one case caught it). R-08, reading another user's orders, had held and is now tested. A passive [OWASP ZAP scan](packages/qa-practice-api/README.md#security-scan) of every OpenAPI operation runs in CI: it found two missing headers (fixed, now FAIL rules) and showed its first run reached only 5 of 13 operations because the spec had no request bodies or parameters (added). Every finding is triaged in the README as fixed, accepted or false positive; anything untriaged fails the job, and a root test keeps the triage, the rule file and the job in step (9 deliberate breaks, each caught) |

### Days 37–42: AI quality

| Day | Work | Status |
|---:|---|---|
| 37 | Validating AI-written code, part 1: spec and requirement review for discount codes; an AI writes the feature 🤖 | ✅ [docs/ai-written-code](docs/ai-written-code/README.md): the nine-line request was reviewed before any code existed. All nine lines needed work: 24 findings (14 missing cases, 8 ambiguities, 2 risks) became a spec of 25 numbered rules and six worked examples, with 2 open questions left out of scope rather than guessed. Among them: 10% of $10.05 rounds to $1.00 with the obvious JavaScript (the spec now says whole cents, half up), different messages for unknown and disabled codes would let anyone probe for codes, and changing what `total` means would silently overcharge in every existing client. The AI then wrote the feature from the exact [prompt](docs/ai-written-code/ai-run/prompt.md), committed unedited before anything ran. It passed every gate it was given (typecheck, the 165 existing tests, the drift check), and none of those gates ran a line of the discount code. A root test keeps the request, log, spec and prompt in step (10 deliberate breaks, each caught) |
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
