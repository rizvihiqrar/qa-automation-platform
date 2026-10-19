# ci-dashboard

A dashboard of this repository's CI health: how often each package passes, how long its job takes, and which jobs are flaky. It's built from the GitHub Actions API after every CI run on `main` and published to GitHub Pages.

**Live:** https://rizvihiqrar.github.io/qa-automation-platform/

**In plain English:** a test suite is only useful if people trust it. This page shows at a glance whether the tests are reliable (do they pass consistently, or flip between pass and fail?) and whether they're getting slower.

---

## What It Shows

| Section | Shows |
|---|---|
| Summary tiles | Runs analysed, share of runs fully green, median run time, flaky job results |
| Jobs passed per run | Share of package jobs that passed in each of the last runs |
| Run duration | Wall-clock minutes per run (a separate chart, not a second axis) |
| Median job time by package | Slowest packages first; hover or focus a bar for the 90th percentile |
| Packages table | Pass rate, result count, median and p90 time, status, last failure |
| Run-by-run data | The same numbers as a table, behind "Show run-by-run data" |

**Flaky** counts two patterns:
1. A job that failed and then passed when the same run was **re-run**.
2. A job that failed in one run and passed in another run of the **same commit**, so nothing in the code changed.

Only a job's last attempt counts toward its pass rate, and cancelled or skipped jobs are left out. Pass rates, times, last failures and the trend count runs on `main` only: a failure on a feature branch is usually a change still in progress, and counting those made healthy packages read "Has failures" for days after the work merged green. Flaky detection still reads every branch, since a job that fails and then passes on the same commit is flaky wherever it ran. The default window is the last 80 runs, about half of them on `main`. The status column says how a package is now, while the pass rate and last failure keep the history: **Failing** if its latest run on `main` failed, **Flaky** if it failed and passed on the same commit or a re-run, **Recovered** if it failed earlier in the window and has passed since, otherwise **Stable**. A "Failing now" tile counts the first kind. The page is rebuilt after every CI run on `main` (including the nightly one), and the daily CI health check opens an issue if it hasn't been rebuilt for 26 hours.

---

## Design

- One self-contained HTML file: no external scripts, fonts or styles.
- Light and dark themes, following the system setting.
- Every package is listed in a table rather than given its own colour, since 23 colours can't be told apart.
- Hover and keyboard focus show values; the arrow keys step through runs on the line charts. Everything a tooltip shows is also in a table.
- Names from the API are escaped, and the embedded chart data can't close its script tag (both tested).
- An API hiccup doesn't sink the build. The jobs request for a run with many re-run attempts sometimes gets a 502 that clears a few seconds later; four builds on 2026-10-19 failed that way. 5xx and network errors are retried with backoff (2s, 4s, 8s), and a run whose jobs still fail is left out with a warning. A 4xx (bad token, rate limit) still fails the build, since it would hit every run.

The first render used SVG for the bar chart, which scaled its labels up on desktop and down on phones. The bars are now HTML, so text stays at the page's normal size at any width.

---

## Usage

```bash
npm run build                      # writes site/index.html and site/metrics.json
node src/build.js --out site --repo owner/name --limit 80
```

The token comes from `GITHUB_TOKEN` or the signed-in GitHub CLI.

The `Dashboard` workflow (`.github/workflows/dashboard.yml`) runs after each CI run on `main` and deploys to Pages.

---

## Published Test Reports

**Live:** https://rizvihiqrar.github.io/qa-automation-platform/reports/

After each CI run on main, the Dashboard workflow downloads that run's `report-*` artifacts and publishes them under `/reports/`, with an index showing each suite's CI result. Nine reports today: the merged Sauce Demo regression report, the Playwright reports of five suites, the Cucumber report, the Postman (Newman) report, the Stryker mutation report, and the accessibility audit (Markdown).

```bash
node src/build.js --out site --reports <folder of report-* artifacts> --reports-run <CI run id>
```

A report on Pages is public, so `src/reports.js` checks everything before copying it:

| Content | Check |
|---|---|
| Text files (HTML, JSON, Markdown, ...) | JWTs, bearer tokens, GitHub tokens, Anthropic keys and Windows user paths are replaced with `[redacted ...]` |
| Zipped data (Playwright reports embed their results as a zip; traces are zips) | Unzipped and scanned. A report with a token in it is **withheld**, and the index says why |
| An archive that can't be read | Withheld: what can't be checked isn't published |

This caught a real leak before the first publish: the Postman report shows the demo API's login responses, which contain live (short-lived) access and refresh tokens. The first published run redacted 19 of them. Sauce Demo's password `secret_sauce` stays visible: it's printed on the site's login page and is in the public test code.

The scan doesn't look for employer or personal names; that check runs before every push instead, so the list of names never has to be written into public code.

## Traceability Matrix

**Live:** https://rizvihiqrar.github.io/qa-automation-platform/reports/traceability/

For each of qa-practice-api's 18 requirements: the risks it addresses, the designed test cases that check it, and each case's result in the CI run the reports came from. `src/traceability.js` joins two things that already exist:

- the [test plan](../../docs/test-strategy/test-plan.md), where every case row names its requirement and every requirement names its risks;
- the JSON report qa-practice-api writes on every run (`reports/results.json`), matched on the case ID each designed test's title starts with.

A requirement passes only when **every** one of its cases passed: one failed case makes it failing, and a case with no result (renamed, skipped, or the suite didn't run) makes it incomplete, so a high pass count can't hide a missing test. The page also flags tests naming a case the plan doesn't have, case IDs used twice, and cases citing an unknown requirement. `matrix.json` next to the page has the same data.

```bash
npm test --prefix ../qa-practice-api   # writes reports/results.json
node src/traceability.js --plan ../../docs/test-strategy/test-plan.md --results ../qa-practice-api/reports/results.json --out site/traceability
```

Checked by putting two fixed bugs back into qa-practice-api (shipped orders could be cancelled; `limit=0` fell back to 10): the matrix went from 12/12 to 9/12 requirements, naming REQ-06, REQ-07 and REQ-08 and the exact cases (TC-ST-15, TC-ST-28, TC-BVA-14). The 38 older route tests passed throughout. `scripts/test-plan.test.mjs` reads the plan with the same parser, so the plan check and the matrix can't disagree about what the plan says.

---

## Tests

```bash
npm test   # 40 tests
```

They cover pass rates by last attempt, both kinds of flaky detection, medians and p90s, API paging and errors with a fake `fetch` (5xx and network errors retried with backoff, a run that keeps failing skipped, a 4xx failing at once), escaping of a hostile job name, and the page being self-contained. For the reports: each secret pattern, text that must not be redacted, stored and deflated zips (built by a small zip writer in the test), picking the page to link, mapping reports to CI jobs by last attempt, publishing vs withholding (including a token inside a trace and a corrupt archive), and escaping on the index page. Four deliberate breaks to the publish guard each made a test fail. For the traceability matrix (13 tests): parsing the real plan (18 requirements, 119 cases), Playwright statuses through nested suites, the worst result winning for a duplicated ID, the requirement status rules, unplanned and orphan cases, a missing or corrupt results file, and escaping plan text. Six deliberate breaks (ignoring missing results, best result winning, skipping nested suites, matching an ID anywhere in a title, unknown statuses passing, unescaped text) each made a test fail.
