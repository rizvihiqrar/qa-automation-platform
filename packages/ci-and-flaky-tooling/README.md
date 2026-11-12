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
- 62 tests, and each fixed bug was put back once to show a test fails

## Results

| Check | Result |
|---|---|
| Tests | 62, run three times with no failures |
| Bugs put back | 21 of 21 made a test fail |
| Quality gates | 8 listed (6 block a job, 2 only report), each checked against the file that sets it ([list](docs/gates.md)) |
| Fix log | 9 pipeline failures, each with a check that stops it coming back ([log](docs/fixes.md)) |
| October 2026 | 4 escaped bugs, 2 caught before main; 9.2% flaky; red main fixed in a median of 16.5 h ([report](reports/2026-10.md)) |
| November 2026 | 1 escaped bug; 2.6% flaky; red main fixed in a median of 3.3 h ([report](reports/2026-11.md)) |

## License

MIT
