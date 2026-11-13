[![ci-and-flaky-tooling: the quality report a manager reads, and the escaped-bug log behind it](docs/banner.svg)](docs/banner.svg)

# ci-and-flaky-tooling

A one-page quality report built from this repository's real CI runs and a log of escaped bugs. It is for a QA lead or manager who wants four honest numbers, each printed with what it counts, why it is tracked and how it can mislead. It leaves out the number of tests and code coverage on purpose, because neither tells you whether the tests catch anything.

**In plain English:** a green dashboard does not say whether quality is getting better. This reads how often the checks flip between red and green, how long a broken main stays broken, how long a run takes and which bugs got past every check, and writes it as a page a manager can read in a minute. Each number comes with a warning about how it can fool you.

**[Technical guide →](TECHNICAL.md)**

| Metric | November 2026 |
|---|---|
| Escaped bugs | 1 (0 more caught before main) |
| Flaky rate | 2.6% (1 of 39 runs) |
| Time to fix a red main | median 3.3 h over 1 red |
| CI run time | median 3.1 min, slowest tenth 4.3 min |

*The top of the [November report](reports/2026-11.md), made from the live runs on main. The [October report](reports/2026-10.md) has four escaped bugs, the first entries from the root-cause pages.*

## Installation

```bash
cd packages/ci-and-flaky-tooling
```

Node 24 or later. There is nothing to install: Node runs the TypeScript directly, and the package has no dependencies.

## Quick start

```bash
npm run report -- --month 2026-11 --out reports/2026-11.md
```

```text
Wrote reports/2026-11.md (124 runs, 0 escaped-bug issues)
```

It reads the finished CI runs on main for that month (and two weeks either side, so a red that crosses a month end is measured) and every issue labelled `escaped-bug`, then writes the report. Without `--out` it prints the report.

## Other Commands

```bash
npm run planning     # rewrites docs/burndown.md and docs/estimates.md from data/sprint.json and data/releases.json
npm run live-proof   # runs the stop-lost-run reporter in real Playwright, four runs, and fails if any does the wrong thing
```

The reporter is one line in a Playwright config: `reporter: [['list'], ['path/to/stop-lost-run.ts', { rate: 0.3, after: 20 }]]`. [Technical guide](TECHNICAL.md) has the rules and the options.

## At a glance

- Four metrics: escaped bugs, flaky rate, time to fix a red main, CI run time
- Each metric shows a definition, why it is tracked and how it can mislead
- No number-of-tests or coverage metric, and the page says why
- A red main that has not ended is shown as still red, never dropped
- A green run that someone ran again is not counted as flaky: only runs whose first attempt failed are
- Escaped bugs come from a GitHub issue form with a "Which test should have caught it" field
- The six root-cause pages in `docs/rca` are the first entries, each classified once
- An issue with a missing field is listed as needing a fix, not counted as zero
- Every root-cause page must have an entry, so a new page cannot be forgotten
- Real runs through the GitHub API; tests use small saved samples and never touch the network
- Every quality gate in one policy file (`data/gates.json`): its threshold, its owner and whether it blocks a job or only reports. A test reads each workflow and script and fails when a threshold changes or a gate is added that the file does not list
- A fix-the-pipeline log (`data/fixes.json`): nine real failures with the cause, the pull request and the check that stops each one coming back. A test fails when an entry names a check that does not exist
- A Playwright reporter, `src/stop-lost-run.ts`, that stops a run once 30% of the first 20 or more finished tests have failed, with a plain message: a broken deploy fails in a minute, not after the whole suite. A failure a retry will redo is not counted, and a few flaky failures do not trip it
- A sprint burndown from a ticket export and the day's last test run, checked against a hand count for every day of a 10-day sample sprint ([page](docs/burndown.md))
- Estimates against actuals per release: variance in hours and percent, a flag above 10% over, and a trend line over the last five releases ([page](docs/estimates.md)). The sample hours are invented and labelled as such
- 96 tests, and each fixed bug was put back once to show a test fails

## Results

| Check | Result |
|---|---|
| Tests | 96, run three times with no failures |
| Bugs put back | 46 of 46 made a test fail |
| Stop a lost run (real Playwright) | A broken run stops at check 20 of 60 (13.6 s, against 42.1 s for all 60 with the reporter off); a healthy run and one with 5 flaky failures in the first 20 are left alone |
| Burndown | All 10 days of the sample sprint match the hand count (tickets left, the even line and failing cases) |
| Estimates | Variance, the over-budget flag and the trend slope (+3.0 points per release) match a hand calculation |
| Quality gates | 8 listed (6 block a job, 2 only report), each checked against the file that sets it ([list](docs/gates.md)) |
| Fix log | 9 pipeline failures, each with a check that stops it coming back ([log](docs/fixes.md)) |
| October 2026 | 4 escaped bugs, 2 caught before main; 9.2% flaky; red main fixed in a median of 16.5 h ([report](reports/2026-10.md)) |
| November 2026 | 1 escaped bug; 2.6% flaky; red main fixed in a median of 3.3 h ([report](reports/2026-11.md)) |

## License

MIT
