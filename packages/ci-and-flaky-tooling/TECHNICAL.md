# ci-and-flaky-tooling: technical guide

[← Back to overview](README.md)

**Contents:** [Features](#features) · [Configuration](#configuration) · [CI integration](#ci-integration) · [FAQ](#faq) · [Troubleshooting](#troubleshooting) · [Development](#development) · [License](#license)

## Features

### The four metrics

| Metric | Source | Definition | How it can mislead |
|---|---|---|---|
| Escaped bugs | `data/escaped-bugs.json` and issues labelled `escaped-bug` | A bug that reached main past every check that ran on its change, found later | A low count can mean few people looking. A bug fixed and not logged improves the number |
| Flaky rate | CI runs on main | Finished runs whose first attempt failed and a later attempt passed, divided by finished runs. A green run that was run again is not counted: its first attempt is read from the API | A re-run after a real outage counts. A flaky test people have stopped re-running does not |
| Time to fix a red main | CI runs on main | From the first failed run to the start of the next green run; several failures in a row are one red | A fix that turns the check off is fast and wrong. A weekend red counts its full length |
| CI run time | CI runs on main | Minutes from the start to the end of the last attempt: median and slowest tenth | A faster run can mean weaker checks |

"CI runs on main" are pushes, the nightly run and manual runs. Cancelled, skipped and unfinished runs are left out of every number. A month with no runs prints "no runs", not zero. Runs are read for the month and two weeks either side, so a red that began in one month and ended in the next is counted in the month it ended; one still open that began after the month is left to a later report. If a month holds more runs than ten pages of 100, the command stops with an error instead of reporting a partial month. A red main still open at the time of the report is printed as **Still red**, with how long, because dropping it would make a long outage improve the median.

The report has no number-of-tests or coverage metric. A test checks that the printed metric list is exactly these four, so adding one means changing the test and saying why.

### Escaped bugs

An escaped bug has a layer: the kind of check that should have caught it (`unit`, `integration`, `end-to-end`, `load`, `ci-environment`, `review`, `monitoring`). Two sources feed one list:

1. **The root-cause pages in `docs/rca`.** `data/escaped-bugs.json` classifies each once: escaped or caught before main, the layer, and the test that should have caught it. The tests added are read from each page's "Regression tests" section, so they are not copied by hand. A page that holds two bugs (page 2) gives each entry only its own tests, using `testFile`.
2. **Issues filled in with the form** in [.github/ISSUE_TEMPLATE/escaped-bug.yml](../../.github/ISSUE_TEMPLATE/escaped-bug.yml). The form asks what happened, which layer missed it, which test should have caught it, the test added and the date found (blank means the day the issue was opened; a bad date is a problem, not a silent wrong month). The report reads GitHub's answers under each `###` heading.

An issue with no layer, an unknown layer or no "should have caught" answer is listed under **Issues that need fixing** instead of being counted or dropped. An issue with no test added yet is counted, and named under **Still without a test**.

The six pages hold seven bugs: five escaped and two were caught before main (the receiver's concurrency test, and the mistyped tag). Four of the five escaped in October and one, the game day, in November.

### What stops it going wrong

| Guard | Test |
|---|---|
| Every page in `docs/rca` has a seed entry | `every root-cause write-up has an entry in the escaped-bug seed` |
| The form and the parser agree on the headings and layers | the three issue form tests in `escaped.test.ts` |
| An open red is never dropped | `a red that has not ended is reported as still red` |
| A failed re-run is not flaky, and neither is a green run run again | `a run that was re-run and stayed red is a failure, not a flaky run`, `a green run that someone ran again is not flaky` |
| A red that crosses a month end is counted once, in the month it ended | `a red that began last month and ended this month is counted in this month` |
| A month too big for the page limit is an error | `a month with more runs than the page limit is an error` |
| Pull requests are not issues | `escaped-bug issues come from the label, open and closed, and pull requests are skipped` |

### Quality gates and the fix log

| File | What it holds | What fails when it drifts |
|---|---|---|
| `data/gates.json` | Each gate: threshold, owner, blocks or reports, the file that sets it, and the exact text (with a count) that must appear there | `every gate in the policy file matches the file that enforces it`: a changed threshold, a moved file, or a gate copied into a second job the file does not list |
| `data/fixes.json` | Each pipeline failure fixed: symptom, cause, fix, pull request, minutes open to merge, the check added | `every logged fix is complete and names a check that exists in the repo` |
| `docs/gates.md`, `docs/fixes.md` | The pages a reader sees, written by `npm run policy` | `docs/gates.md is the current output`, so the page cannot go stale |

The checks prove the threshold text is where the list says it is, and how many times. They do not prove the job is switched on (an `if: false` would still match), and a harmless reformat can fail them: that is the price of a list that cannot quietly disagree with CI. Two gates are listed as reported only (the mutation score has `break: null`, and a run that needed a re-run is a CI health problem, not a red job). The list says so, instead of calling every number a gate. "Fix time" in the log is the pull request open to merge, not the length of the red; the length of a red is the metric in the report.

### Stop a run that is already lost

`src/stop-lost-run.ts` is a Playwright reporter. Playwright's own `maxFailures` is a plain count: a big suite reaches it late and a small suite reaches it too early. This reporter uses a rate after a minimum, so a broken deploy fails in about a minute and not after the whole suite has run.

| Rule | Behaviour |
|---|---|
| When it stops | The share of finished tests that failed reaches `rate` (default 0.3, 30%) once `after` tests (default 20) have finished. The first few failures are never judged |
| What counts | A test counts once, at its final result. A failure that a retry will redo is not counted. A test that failed and then passed counts as a pass. A skipped test is not counted. A test marked as expected to fail counts as a pass when it fails |
| What it does | Prints one message with the numbers (`Stopping the run: 20 of 20 finished tests failed (100%; ...)`) and exits with code 1. It asks to stop once, however many more failures arrive |
| Bad options | A rate outside 0 to 1 or a minimum below 1 throws an error naming the option, instead of quietly using a default |

It has no dependencies: it reads only the three fields of Playwright's test and result objects that it needs. The tests feed it fake results. `npm run live-proof` runs it in real Playwright with 60 small checks that need no browser, in four runs: healthy with the reporter on, broken with it off, broken with it on, and 5 flaky failures in the first 20 with it on. Exiting stops the other reporters too, so an HTML report of that run is not written: the point is a fast red, not a full report. The proof borrows `@playwright/test` from another package (default `llm-judge-check`, after `npm ci` there; or `--playwright <folder>`), so it runs by hand and not in CI, which keeps this package free of dependencies.

### Sprint burndown

`src/burndown.ts` reads `data/sprint.json` (a ticket export with opened and closed dates, and the last test run of each day) and gives, for each working day (Monday to Friday):

| Column | How it is worked out |
|---|---|
| Tickets left | Opened on or before the day and not closed on or before it, so a ticket closed on a day is gone by that evening and one opened that day is counted |
| Even line | From day 1's count to zero on the last day, to one decimal |
| Failing cases | The latest run on or before the day. A day with no run shows the earlier number and says `no run: shows <date>`. Before the first run there is no number, never a zero |
| Note | `tickets grew` or `failing cases grew` on a day the work went up instead of down |

The sample sprint (13 tickets, 3 added after day 1, two left open at the end) has a test with the hand count written out in a comment: 10, 9, 10, 9, 8, 7, 5, 4, 3, 2 tickets and 12, 11, 14, 14, 9, 7, 5, 5, 2, 1 failing cases. Bad data (a repeated ticket, a ticket closed before it opened, two runs on one day, more failing than total, a weekend start) is reported by `checkSprint`, not drawn. The page `docs/burndown.md` is written by `npm run planning`, and a test fails when it is stale. A ticket closed or a run made on a weekend is counted on the next working day, because only working days are drawn. A run's `interrupted` tests (Ctrl-C, a global timeout) are never counted by the reporter as failures. There is no reader for live ticket data yet: the file is the interface.

### Estimates against actuals

`src/estimates.ts` reads `data/releases.json` (estimate and actual hours per release). Variance is actual minus estimate; the percent is that divided by the estimate, so above zero means the release took longer than planned.

| Item | Rule |
|---|---|
| Over budget | More than `overBudgetPercent` (10) over. Exactly 10% is not flagged |
| Trend line | A least-squares line through the percent variance of the last `trendReleases` (5) releases. Under 0.5 points per release is `steady`; above is `over-runs growing`, below is `over-runs shrinking` |
| Totals | All estimated hours, all actual hours, and the overall percent |

The six releases are invented and the file says so: there are no real hour logs. They are chosen so a hand calculation is short: the last five percents are 10, 20, 25, 20 and 25, the slope is 3.0 points per release, four of six are over budget, and the total is 305 hours estimated against 358 actual (+17.4%). A test checks each of those, and `checkEstimates` rejects an empty list, a zero estimate, a repeated release and fewer than two trend releases. If the file has fewer releases than `trendReleases`, the line uses all of them.

### Undoing a Bad Merge (A60)

`src/revert.ts` builds two throwaway repositories in the temp folder (a local bare "origin" and two clones, the author's and a teammate's) and runs the same situation twice: a bad change merged into main, the suite (two `node --test` tests) going red, and the teammate committing on top of it. The first copy is fixed with `git revert -m 1` and an ordinary push; the second with `git reset --hard` and `git push --force`. `npm run revert-demo` prints the steps and the time from the bad merge being pushed to a green suite; [docs/revert.md](docs/revert.md) is the explanation.

- The suite run stands in for CI. On a real pipeline the same time includes the queue and the run, and the quality report's time to fix a red main measures that from real runs.
- `git log --topo-order` is used for the history, because a merge and its revert made in the same second have no fixed order by date (this flaked once, in the second of five runs, before the fix).
- 9 tests (RV-01 to RV-09). The scratch repositories ignore the user's own git settings (global config, hooks, language). The measured time leaves out the teammate's pull and commit, and RV-06 proves it with an injected clock. Deliberate breaks, put back after: resetting and force-pushing in place of the revert failed RV-02 (the bad merge is gone from the history) and RV-03 (the teammate's pull no longer works); reverting with `-m 2` made git refuse, which fails the whole walkthrough.
- Limits: it uses a local origin, so it shows no branch protection. The repository's own ruleset blocks a force-push to main (`non_fast_forward`), which is the real guard.

## Configuration

| Option | Default | What it does |
|---|---|---|
| `--month` | the current month, UTC | The calendar month to report, as `2026-10` |
| `--repo` | `GITHUB_REPOSITORY`, else `rizvihiqrar/qa-automation-platform` | The repository to read |
| `--out` | none (prints the report) | A file to write, relative to the package folder |
| `GITHUB_TOKEN` or `GH_TOKEN` | the GitHub CLI's token, if signed in | Raises the API rate limit. Public data is read without one |

The reporter takes two options in the Playwright config:

| Option | Default | What it does |
|---|---|---|
| `rate` | `0.3` | Stop when this share of finished tests failed (above 0, at most 1) |
| `after` | `20` | Do not judge before this many tests have finished (a whole number, 1 or more) |

## CI integration

The package's tests run as the `ci-and-flaky-tooling` job in [ci.yml](../../.github/workflows/ci.yml) and are type-checked by `npm run typecheck`. The report itself is a command, not a workflow, so a failed API call can never turn main red. To run it every month, add a scheduled workflow that runs `npm run report -- --month <last month> --out reports/<month>.md` and opens a pull request with the file.

## FAQ

### Why is the first month's flaky rate so much higher?

October was the repository's first month, and 11 of its 120 finished runs passed only after a re-run. November has one in 38.

### Why is "escaped" tied to main and not to a release?

This repository has no releases that customers use. The line that matters here is "past every check that ran on that change", which is the point where a fix costs more than a failed pull request.

### Why not count the number of tests?

More tests do not mean fewer escaped bugs, and a target for the count rewards tests that are easy to write and never fail. The escaped-bug list says whether the checks catch things.

### Why are the six pages classified in a file and not in the pages?

The pages are written for a reader, and their tables are checked by `scripts/rca.test.mjs`. One file holds the classification in a form a program can read, and a test makes sure no page is missing from it.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| The report shows 0 escaped issues after one was filed | The `escaped-bug` label does not exist yet, so the form could not add it | Create the label (see Development), then add it to the issue |
| `GitHub answered 403` | The API rate limit for anonymous requests | Set `GITHUB_TOKEN`, or sign in with `gh auth login` |
| An issue appears under "Issues that need fixing" | A form field was left blank, or its heading was edited | Fill in the field, keeping the `###` headings the form wrote |
| Flaky rate says "no runs" | No finished CI runs on main in that month | Check `--month` and `--repo` |

## Development

```bash
cd packages/ci-and-flaky-tooling
npm test            # 105 tests, node --test
npm run report -- --month 2026-11
npm run policy      # checks the gates and the fix log, then rewrites docs/gates.md and docs/fixes.md
npm run planning    # checks the sprint and release data, then rewrites docs/burndown.md and docs/estimates.md
npm run live-proof -- --playwright ../llm-judge-check   # the reporter in real Playwright (needs npm ci there)
```

The label is a repository setting. To create it: on GitHub, open **Issues**, then **Labels**, then **New label**; type `escaped-bug`, choose a colour and select **Create label**.

## License

MIT
