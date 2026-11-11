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

## Configuration

| Option | Default | What it does |
|---|---|---|
| `--month` | the current month, UTC | The calendar month to report, as `2026-10` |
| `--repo` | `GITHUB_REPOSITORY`, else `rizvihiqrar/qa-automation-platform` | The repository to read |
| `--out` | none (prints the report) | A file to write, relative to the package folder |
| `GITHUB_TOKEN` or `GH_TOKEN` | the GitHub CLI's token, if signed in | Raises the API rate limit. Public data is read without one |

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
npm test            # 50 tests, node --test
npm run report -- --month 2026-11
```

The label is a repository setting. To create it: on GitHub, open **Issues**, then **Labels**, then **New label**; type `escaped-bug`, choose a colour and select **Create label**.

## License

MIT
