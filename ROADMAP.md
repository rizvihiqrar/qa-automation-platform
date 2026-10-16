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
| 4 | **AI generator eval**: generate tests for 10 feature files; record the % that pass review, the % that pass a real run, and what a human had to fix | AI-assisted test generation, reviewing AI output | 🔶 harness, 10 verified feature files and scoring built; first paid run needs `ANTHROPIC_API_KEY` |
| 5 | **SQL data-integrity kit** on SQLite: orphan rows, duplicates, totals that don't reconcile | SQL, data integrity checks | ✅ 15 checks, 33 tests, each check proven by an injected defect |
| 6 | **Defect report linter**: required fields, repro steps, expected vs actual, severity | Defect reports, bug lifecycle | ⬜ |
| 7 | **Webhook harness**: signature checks, retries, idempotency | Webhooks, REST APIs | ⬜ |
| 8 | **Log signature grouper**: group error logs by normalized signature | Log analysis, root cause | ⬜ |
| 9 | **OpenAPI drift checker** against qa-practice-api | API testing, contract thinking | ⬜ |
| 10 | **Exploratory session tracker**: charters, time boxes, findings report | Exploratory testing, QA documentation | ⬜ |
| 11 | **k6 performance suite** with thresholds against qa-practice-api | Performance testing (re-add to resume only once this exists) | ⬜ |
| 12 | **Release gate**: block a deploy on smoke results; post a summary | CI/CD, production deployments | ⬜ |
| 13 | **Accessibility** against a local UI, framed around AODA, with a findings report | Accessibility | ⬜ |
| 14 | **Results dashboard** wired to CI: pass rate, runtime, flake rate over time | Impact metrics | ⬜ |

## Days 15–21: TypeScript

The resume leads with TypeScript, so convert one area a day, keeping CI green after each.

| Day | Scope | Status |
|---:|---|---|
| 15 | Shared `tsconfig`, type-check job in CI | ⬜ |
| 16 | test-data-factory | ⬜ |
| 17 | flaky-test-analyzer, worker-scaling-benchmark | ⬜ |
| 18 | ai-test-generator | ⬜ |
| 19 | qa-for-ai-features, qa-practice-api | ⬜ |
| 20 | multi-user-flow-patterns, bdd-playwright-demo | ⬜ |
| 21 | Remaining packages | ⬜ |

## Days 22–30: Pipeline depth and polish

| Day | Work | Status |
|---:|---|---|
| 22 | Shard the browser suites across runners | ⬜ |
| 23 | Feed nightly reports into flaky-test-analyzer; tag flaky tests | ⬜ |
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
