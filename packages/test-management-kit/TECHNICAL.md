[← Back to overview](README.md)

# test-management-kit: technical guide

- [How it fits together](#how-it-fits-together)
- [The data files](#the-data-files)
- [Validation rules](#validation-rules)
- [Exporters](#exporters)
- [Plan and coverage](#plan-and-coverage)
- [Command line](#command-line)
- [CI integration](#ci-integration)
- [Proof that the tests catch mistakes](#proof-that-the-tests-catch-mistakes)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## How it fits together

```text
data/cases.json  ─┐
                  ├─> validate ──> exporters ──> TestRail CSV · generic CSV · Markdown report
data/plan.json   ─┘            └─> plan ───────> runs by section, smoke, integration, security
                               └─> coverage ──> cases per section, priority and type
```

Strict TypeScript, run by Node 24 type stripping, so there is no build step and no dependency. The source is in `src/`: `validate.ts`, `plan.ts`, `coverage.ts`, `csv.ts`, `load.ts`, `cli.ts` and one file per exporter in `src/exporters/`.

## The data files

| File | What it holds |
|---|---|
| [`data/cases.json`](data/cases.json) | The suite name, the eight sections and the 52 cases. The single source of truth |
| [`data/plan.json`](data/plan.json) | The runs that are chosen by a filter: smoke, integration and security |
| [`examples/business-accounting-suite-testrail.csv`](examples/business-accounting-suite-testrail.csv) | The reviewed TestRail import file. A test checks that the exporter reproduces it byte for byte |
| [`examples/broken-data/`](examples/broken-data) | A small data set with six planted problems, used for the validator screenshot and a test |

A case:

```json
{
  "id": "OTC-002",
  "section": "OTC",
  "title": "Credit note against an invoice",
  "description": "Issue a credit note for part of a posted invoice and apply it.",
  "expectedResult": "The invoice balance falls by the credit, and the revenue and tax postings reverse in proportion.",
  "priority": "High",
  "type": "Regression",
  "references": []
}
```

| Field | Rule |
|---|---|
| `id` | `PREFIX-000`, where the prefix is the case's section ID and no ID repeats |
| `section` | One of the section IDs in `cases.json` |
| `title`, `description`, `expectedResult` | Not empty or blank |
| `priority` | Critical, High, Medium or Low (TestRail's defaults) |
| `type` | Regression, Integration, Negative or Security |
| `references` | A list; stage 2 puts Jira keys here |

Steps are left out on purpose. Results belong to runs, not to cases, so the exporters write Status as Untested for every case.

## Validation rules

`validateSuite` and `validatePlan` return a list of problems and never throw on bad content, so one run reports everything.

| Check | Message |
|---|---|
| A required field is missing, empty or blank | `Missing title` |
| Title, description or expected result starts with `=`, `+`, `-` or `@` | `title starts with "=", which a spreadsheet reads as a formula` |
| An ID repeats | `ID "OTC-001" is repeated` |
| An ID is not `PREFIX-000` | `ID "OTC-1" should look like OTC-001` |
| An ID's prefix is not its section | `ID prefix "BBB" does not match section "AAA"` |
| A case names a section that doesn't exist | `Unknown section "ZZZ"` |
| Unknown priority or type | `Unknown priority "Urgent" (use Critical, High, Medium, Low)` |
| References are not a list of non-empty text | `References must be a list of non-empty text` |
| A section has no ID or name, an ID that is not capital letters and digits, or an ID or name that repeats | `Section ID "AAA" is repeated` |
| `sections` or `cases` is not a list | `sections must be a list` |
| A run filter uses an unknown key or value, or is not a list with at least one value | `Unknown priority "Urgent"` |
| A run has no name or no `where` filter | `Run has no name` |
| A run name repeats | `Run name "Smoke" is repeated` |
| A run with a well-formed filter selects no cases (a filter problem is reported once, not twice) | `Run "Security" selects no cases` |

## Exporters

Each exporter is a function from the suite to text. A new tool is a new file in `src/exporters/`.

| Format | Command | Shape |
|---|---|---|
| TestRail | `npm run export:testrail` | Columns Test ID, Section, Title, Description, Expected Result, Priority, Type, Status, References. Every field quoted, a byte order mark, Windows line endings. Section is the full section name. References joined with commas |
| Generic CSV | `npm run export:generic` | Lower-case headers, quotes only where needed, no byte order mark, Unix line endings. References joined with semicolons |
| Markdown | `npm run export:markdown` | Coverage tables, the plan, then every case by section. A pipe inside a cell is escaped |

Importing into TestRail: Type values are Regression, Integration, Negative and Security, and TestRail's default types differ, so map them on import or add them as case types. Description is a custom text field in TestRail, or goes in Preconditions.

## Plan and coverage

The plan has one run per section, so one tester can own a cycle, then the runs from `plan.json`. A run's `where` filter takes lists for `section`, `priority` and `type`: a case matches when it is in every list that is given.

```json
{ "name": "Security", "description": "The Security cases plus the Negative cases", "where": { "type": ["Security", "Negative"] } }
```

| Run | Cases |
|---|---:|
| One per section (8 runs) | 12, 10, 10, 5, 2, 4, 2, 7 |
| Smoke: priority High | 31 |
| Integration: type Integration | 12 |
| Security: types Security and Negative | 7 |

Coverage counts cases per section, priority and type. Every known priority and type is listed, with 0 when it has no cases.

## Command line

```bash
node src/cli.ts <validate|export|plan|coverage> [--data <dir>] [--format <testrail|generic|markdown>] [--out <file>] [--json]
```

| Option | Default | What it does |
|---|---|---|
| `--data` | `data/` | The folder holding `cases.json` and `plan.json` |
| `--format` | `testrail` | The export format |
| `--out` | none | Write the export to a file (folders are created). Without it, the export prints |
| `--json` | off | JSON output for `plan` and `coverage` |

`validate` exits 1 with every problem listed. `export`, `plan` and `coverage` exit 1 without output when validation fails. Tests call `run()` directly, so they need no child process.

## CI integration

One job in the root [CI workflow](../../.github/workflows/ci.yml):

```yaml
- { package: test-management-kit, browsers: false, command: npm test && npm run validate && npm run export:testrail && npm run export:generic && npm run export:markdown }
```

A bad edit to `cases.json` fails the job in two places: `npm test` (the shipped data is tested) and `npm run validate`.

## Proof that the tests catch mistakes

Each change was made on its own, the whole suite was run, and the file was put back. All 30 were caught. The last 11 are the fixes made after the code review.

| Mistake put back | Tests that failed |
|---|---:|
| No required-field check | 4 |
| Repeated ID not reported | 3 |
| Unknown priority accepted | 3 |
| Unknown type accepted | 2 |
| ID prefix not matched to its section | 1 |
| Empty run not reported | 2 |
| Unknown section accepted | 1 |
| Quotes not doubled in CSV | 2 |
| TestRail export without the byte order mark | 2 |
| TestRail export with plain line endings | 4 |
| Wrong status in the TestRail export | 2 |
| Generic references joined with commas | 1 |
| Pipe not escaped in Markdown | 1 |
| Type filter ignored | 2 |
| Priority filter ignored | 4 |
| Zero counts not shown | 4 |
| Export runs on invalid data | 1 |
| `validate` always passes | 2 |
| A bad priority in the shipped data | 5 |
| Repeated section name accepted | 1 |
| Text that starts like a formula accepted | 1 |
| Non-text references accepted | 1 |
| No shape guard on the suite | 1 |
| No shape guard on the plan | 1 |
| A filter typo reported twice | 2 |
| Empty filter list accepted | 1 |
| Lower-case section ID accepted | 1 |
| A run with no filter crashes | 1 |
| Backslash not escaped in Markdown | 1 |
| The CLI entry check never true | 2 |

One more change was tried and not kept: a guard for an empty section list in the coverage text made no visible difference, so it was removed again. The test for that case stays.

## FAQ

### Why JSON and not a spreadsheet?
A reviewer sees exactly which case changed, and the same file feeds every tool. A spreadsheet hides changes in a binary file.

### Where do the cases come from?
They are original and general, written from standard accounting practice. Nothing was copied from a company's checklist.

### Has it been imported into TestRail?
No. The CSV matches the reviewed import file byte for byte, but no TestRail instance was used, so the import itself is unverified.

### Can I add a case?
Add it to `cases.json` with the next ID in its section, then run `npm test`. The data tests also check the totals, so update the counts they state.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `Could not read ...cases.json` | `--data` points at a folder without the two files | Check the path; it needs `cases.json` and `plan.json` |
| `Refusing to export: N problem(s)` | The data fails validation | Run `npm run validate` and fix what it lists |
| `Run "X" selects no cases` | A filter matches nothing, often a typo in a value | Fix the filter in `plan.json` |
| Garbled first column header when opening the CSV | The tool doesn't read the byte order mark | Use the generic CSV |
| `ERR_UNKNOWN_FILE_EXTENSION` for `.ts` | An old Node that cannot run .ts files | Use Node 24 or later |

## Development

```bash
npm ci
npm test            # 58 tests
npm run validate
npm run validate:broken   # exits 1 on purpose
npx tsc -p tsconfig.json --noEmit   # from the repo root: npm run typecheck
```

The screenshots are real command output, captured by [`scripts/screenshots/terminal.mjs`](../../scripts/screenshots/terminal.mjs): `cd scripts/screenshots && npm run terminal -- coverage plan validate-broken`.
