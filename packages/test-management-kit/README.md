[![test-management-kit: test cases as plain data, one source, many tools](docs/banner.svg)](docs/banner.svg)

# test-management-kit

A kit for keeping test cases as plain data in a repository, instead of locked inside one tool. 52 original test cases for any business that keeps books sit in one JSON file, organised by the accounting cycles (order to cash, procure to pay, record to report, hire to pay) plus inventory, fixed assets, sales tax and controls. A validator fails on a missing field, a repeated ID or an unknown priority or type. Exporters then turn the same data into a TestRail import file, a generic CSV for any other tool, and a Markdown report that needs no tool at all. The kit also builds a test plan (a run for each cycle, plus smoke, integration and security runs) and counts the cases by section, priority and type.

**In plain English:** most teams keep their test cases in a tool such as TestRail or Jira, and moving to another tool means retyping them. Here the cases live in one file in the repository, where they are reviewed like code. The kit checks that nothing is missing or repeated, then writes out whichever format a tool wants. The cases are written for accounting in general. They are not copied from any company's checklist.

**[Technical guide →](TECHNICAL.md)**

[![The coverage report: 52 cases counted by section, priority and type](docs/coverage.png)](docs/coverage.png)

*`npm run coverage`: 52 cases across eight accounting sections, 31 High and 21 Medium priority, and four case types. A known value with no cases, such as Critical, shows as 0 instead of disappearing. ([dark version](docs/coverage-dark.png))*

## Installation

```bash
cd packages/test-management-kit && npm ci
```

Node 24 or later. No dependencies: Node runs the TypeScript directly.

## Quick start

Check the cases, then write the file TestRail imports.

```bash
npm run validate
npm run export:testrail   # out/testrail-import.csv
```

## At a glance

- 52 original cases in 8 sections, kept as one JSON file that is the single source of truth
- A validator that fails on a missing or blank field, a repeated ID, an ID that doesn't match its section, an unknown priority, type or section, text a spreadsheet would read as a formula, and a data file with the wrong shape (it reports these, never crashes)
- A TestRail import CSV that matches the reviewed import file byte for byte
- A generic CSV for any other tool, and a Markdown report that needs no tool
- A test plan with a run for each accounting cycle, plus smoke (the 31 High cases), integration (12) and security (7) runs
- A coverage report: cases per section, priority and type
- Export, plan and coverage refuse to run on data that fails validation
- 58 tests, each bug put back once to show a test catches it

[![The validator on a deliberately broken sample: six problems listed, one per line, and exit code 1](docs/validate-broken.png)](docs/validate-broken.png)

*`npm run validate:broken` on a sample with a repeated ID, an empty expected result, an unknown priority and type, and two runs that select nothing. Every problem is listed with its case ID, and the command exits 1. ([dark version](docs/validate-broken-dark.png))*

[![The test plan: one run per section, then Smoke 31, Integration 12 and Security 7](docs/plan.png)](docs/plan.png)

*`npm run plan`: one run for each accounting cycle, so one tester can own a cycle, then the smoke, integration and security runs. ([dark version](docs/plan-dark.png))*

## What was checked against what

| Part | Checked how |
|---|---|
| The cases and plan | The validator, in CI on every run, and 58 tests |
| The TestRail CSV | Matches the reviewed import file byte for byte. It has **not** been imported into a live TestRail: no TestRail instance was used |
| The generic CSV and Markdown report | Checked by tests only |

Stage 1 stops at the files. Sending results to TestRail and creating Jira issues for failed cases is stage 2, and this page will say which of those were checked against a mock and which against a live service.

## Results

[![The test run: 58 tests pass](docs/kit-tests.png)](docs/kit-tests.png)

*A slice of `node --test`: the validator and exporter tests, and the totals. ([dark version](docs/kit-tests-dark.png))*

- 58 tests pass, run five times in a row
- 30 mistakes were put back on purpose, one at a time (no required-field check, repeated IDs accepted, a byte order mark dropped, a filter ignored, and so on), and each made at least one test fail. [The list](TECHNICAL.md#proof-that-the-tests-catch-mistakes)
- CI runs the tests, validates the shipped cases and writes all three exports on every run

## License

MIT
