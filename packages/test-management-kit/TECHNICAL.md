[← Back to overview](README.md)

# test-management-kit: technical guide

- [How it fits together](#how-it-fits-together)
- [The data files](#the-data-files)
- [Validation rules](#validation-rules)
- [Exporters](#exporters)
- [Plan and coverage](#plan-and-coverage)
- [Results, TestRail and Jira (stage 2)](#results-testrail-and-jira-stage-2)
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

run results ─> validate ─┬─> TestRail reporter ──> add_results_for_cases  (status, comment, time, issue keys)
(JSON, after a run)       └─> defect-report-linter ─> Jira issue creator ──> POST /rest/api/3/issue
                                  (not ready: nothing filed)        └─> keys written back to the results file
```

Strict TypeScript, run by Node 24 type stripping, so there is no build step and no dependency. The source is in `src/`: `validate.ts`, `plan.ts`, `coverage.ts`, `csv.ts`, `load.ts`, `cli.ts` and one file per exporter in `src/exporters/`. Stage 2 adds `results.ts` (the results file), `testrail.ts`, `jira.ts`, `http.ts` (one request function with the retry), `linter.ts` (the one import of the defect-report-linter), `integrate.ts` (the two commands) and `mock.ts` (the local stand-in for both tools).

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

## Results, TestRail and Jira (stage 2)

### The results file

What a test run produces, as plain JSON. Only `caseId` and `status` are needed; the rest describes a failure.

```json
{ "runId": 1, "results": [
  { "caseId": "OTC-001", "status": "passed", "elapsed": "45s" },
  { "caseId": "OTC-002", "status": "failed", "severity": "high",
    "environment": "Chrome 130 on Windows 11, staging build 2026.11.1",
    "steps": ["Create and post an invoice", "Issue a credit note and apply it"],
    "actual": "The invoice balance fell but the revenue account still shows 1000.00",
    "evidence": ["screenshots/OTC-002-ledger.png"] }
] }
```

Status is `passed`, `failed`, `blocked` or `retest`. `elapsed` uses TestRail's form (`30s`, `1m 45s`). The file is checked against the suite first: an unknown case, a case reported twice, a bad status or time, or a field of the wrong type is listed with its case ID, and nothing is sent. [`examples/run-results.json`](examples/run-results.json) is a working sample.

### The case map

TestRail gives each case a number when the CSV is imported (C101 is 101). [`examples/testrail-map.json`](examples/testrail-map.json) maps our case IDs to those numbers. It is checked the same way: a case with no number, a number used twice, or an ID that is not in the suite is reported. The shipped map numbers the cases from 101 in order, so replace it with the real numbers after an import.

### The TestRail reporter

`report-testrail` sends one `POST index.php?/api/v2/add_results_for_cases/{run_id}` with Basic sign-in (user name and API key). It uses TestRail's default status ids (passed 1, blocked 2, retest 4, failed 5), so a project that renamed or added statuses needs its own table in `testrail.ts`. `comment`, `elapsed` and `defects` are sent only when set. The run comes from `--run-id` or the file's `runId`.

### The Jira issue creator

`create-jira` files one Bug per failed case with `POST /rest/api/3/issue` and Basic sign-in (account email and API token). Each failure becomes a defect report (title, severity, environment, steps, expected, actual, evidence) and goes through the [defect-report-linter](../defect-report-linter/README.md) before anything is sent:

- **An error stops the whole run.** A failure with no steps, no actual result, a severity the linter does not know, or an actual result equal to the expected one means no issue is filed for any case. Filing is all or nothing so a re-run after fixing the report cannot leave half a batch behind.
- **A warning is shown and filing goes on.** A serious failure with no evidence, or an environment missing, costs points but is not blocked.
- **Severity** comes from the result, or from the case priority if the result gives none. It maps to Jira's priority names (critical Highest, high High, medium Medium, low Low).
- **The description** is an Atlassian Document (headings and lists for steps, expected, actual, environment, evidence and the case's references). The v3 endpoint refuses plain text, and the mock refuses it too.
- **A case that already has an issue key** in its `defects` field is skipped, so running twice cannot file duplicates.
- **`--out <file>`** writes the results back with each `defects` set to its issue key. That file feeds `report-testrail`, so the keys reach TestRail. If filing stops part way, the keys already filed are still saved, and the message says so.

### The local mock

`src/mock.ts` is one small server that speaks the parts of both APIs the kit uses, on a port Node picks, so it can run in CI. It answers as the documentation describes: 401 for a wrong key or token, TestRail's `{"error": ...}` for an unknown run, a case that is not in the run or a bad time, Jira's `{"errorMessages", "errors"}` for an unknown project or a description that is not a document, and a 429 with `Retry-After` on request. The kit retries a 429 up to twice, waiting at most five seconds each time.

A mock shows what the kit sends and how it handles the documented answers. It cannot show that the real services accept the same request, which is why the README says which parts were run live and which were not.

### Security

- Credentials come only from `TESTRAIL_USER`, `TESTRAIL_API_KEY`, `JIRA_EMAIL` and `JIRA_API_TOKEN`. There is no option for them, so they never appear in shell history or process lists.
- `--base-url` must be https. Plain http is allowed only for `localhost` and `127.0.0.1`, so a typo cannot send a key across the network in the clear.
- Error messages name the address and the server's own words, never the key or token. `--dry-run` prints each request with the sign-in line replaced by `Basic ***` and sends nothing, and needs no credentials.

## Command line

```bash
node src/cli.ts <validate|export|plan|coverage> [--data <dir>] [--format <testrail|generic|markdown>] [--out <file>] [--json]
node src/cli.ts report-testrail --results <file> --map <file> --base-url <url> [--run-id <n>] [--dry-run]
node src/cli.ts create-jira --results <file> --project <KEY> --base-url <url> [--out <file>] [--dry-run]
```

| Option | Default | What it does |
|---|---|---|
| `--data` | `data/` | The folder holding `cases.json` and `plan.json` |
| `--format` | `testrail` | The export format |
| `--out` | none | Write the export to a file (folders are created). Without it, the export prints |
| `--json` | off | JSON output for `plan` and `coverage` |
| `--results` | none | The results file (both stage 2 commands) |
| `--map` | none | Case ID to TestRail ID file (`report-testrail`) |
| `--base-url` | none | The server address; https, or http for localhost only |
| `--run-id` | the file's `runId` | The TestRail run to report into |
| `--project` | none | The Jira project key, such as `KIT` |
| `--dry-run` | off | Print the requests with the sign-in hidden and send nothing |

`validate` exits 1 with every problem listed. `export`, `plan` and `coverage` exit 1 without output when validation fails. Tests call `run()` and `runIntegration()` directly, so they need no child process. The two stage 2 commands also refuse to run on data or results that fail validation.

## CI integration

One job in the root [CI workflow](../../.github/workflows/ci.yml):

```yaml
- { package: test-management-kit, browsers: false, command: npm test && npm run validate && npm run export:testrail && npm run export:generic && npm run dry-run:testrail && npm run dry-run:jira && npm run demo }
```

A bad edit to `cases.json` fails the job in two places: `npm test` (the shipped data is tested) and `npm run validate`. The two dry runs check the sample results file and map still work together, and `npm run demo` runs the whole flow against the mock, so a change that breaks the flow fails CI even if no unit test names it. The job imports the defect-report-linter from the neighbouring package, so a change to a linter rule can change which failures the kit will file.

## Proof that the tests catch mistakes

Each change was made on its own, the whole suite was run, and the file was put back. All 30 stage 1 mistakes were caught. The last 11 are the fixes made after the code review.

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

### Stage 2

The same method for the reporter and the Jira creator: 26 mistakes, each caught. The last 10 are the fixes made after the code review (below). Two of the first 16 were not caught the first time. The Basic sign-in header was built by the same function the mock used to check it, so a wrong encoding agreed with itself; a test now pins it to the worked example in the Basic authentication standard (RFC 7617). The mock's time check was never reached because the reporter validates first; a test now sends a bad time straight to the mock.

| Mistake put back | Tests that failed |
|---|---:|
| Failed case sent with the wrong TestRail status | 4 |
| Trailing slash kept in the base address | 2 |
| No retry on a 429 | 4 |
| Wrong Basic sign-in encoding | 2 |
| Dry run no longer hides the sign-in line | 4 |
| Plain http allowed to any host | 2 |
| The linter no longer blocks filing | 5 |
| A re-run files duplicates | 4 |
| Description sent as plain text, not a document | 9 |
| Critical severity mapped to the wrong Jira priority | 2 |
| Two cases given the same TestRail ID | 2 |
| A case reported twice in the results | 2 |
| Any elapsed time accepted | 2 |
| Missing Jira project not caught | 2 |
| Keys lost when filing stops part way | 2 |
| The mock stops checking the time format | 2 |
| Jira document with its version inside `attrs`, not on the document | 11 |
| A 200 answer that is not JSON accepted as success | 2 |
| Fewer results stored than sent accepted | 2 |
| Blank steps and evidence kept (an empty text node) | 2 |
| A case title over 255 characters not cut | 2 |
| Issue keys not printed when the `--out` file cannot be written | 2 |
| An option that does nothing for the command accepted | 2 |
| The mock stops checking the document version | 2 |
| The mock stops refusing an empty text node | 2 |
| The mock stops refusing a summary over 255 characters | 2 |

The code review of this change found one real bug the first 16 breaks could not: the description put `version` inside `attrs` instead of on the document, and the mock was too lenient to notice, so real Jira would have refused every issue. The mock now checks the version, empty text and the summary length, which is the reason a mock needs its own tests.

One more change was tried and not kept: a guard for an empty section list in the coverage text made no visible difference, so it was removed again. The test for that case stays.

## FAQ

### Why JSON and not a spreadsheet?
A reviewer sees exactly which case changed, and the same file feeds every tool. A spreadsheet hides changes in a binary file.

### Where do the cases come from?
They are original and general, written from standard accounting practice. Nothing was copied from a company's checklist.

### Has it been imported into TestRail?
No. The CSV matches the reviewed import file byte for byte, but no TestRail instance was used, so the import itself is unverified.

### Has it been run against live TestRail or Jira?
Jira yes, once; TestRail no. The TestRail side is tested against a local mock only, by choice, with no trial account. The Jira creator was run on 2026-11-01 against a free Jira Cloud site (Free plan, team-managed project, Bug work type): `--dry-run` first, then one real issue from a results file cut down to a single failed case. Jira accepted `POST /rest/api/3/issue` on the first real request, the key was written back to the results file, and the issue showed the heading, the numbered steps and the High priority the kit maps from severity high. The mock was not changed afterwards; the live run did not show a difference for this request. It proves one request shape on one plan: the 400, 401 and 429 answers were not tried live, and other plans or classic projects may require more fields. The token went in an environment variable for one window only.

### Why does one weak failure report stop every issue?
Filing part of a batch and stopping makes a re-run confusing. Checking every report first, and filing nothing until all are ready, means the fix is to improve the reports and run again.

### Can I add a case?
Add it to `cases.json` with the next ID in its section, then run `npm test`. The data tests also check the totals, so update the counts they state.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `Could not read ...cases.json` | `--data` points at a folder without the two files | Check the path; it needs `cases.json` and `plan.json` |
| `Refusing to export: N problem(s)` | The data fails validation | Run `npm run validate` and fix what it lists |
| `Run "X" selects no cases` | A filter matches nothing, often a typo in a value | Fix the filter in `plan.json` |
| Garbled first column header when opening the CSV | The tool doesn't read the byte order mark | Use the generic CSV |
| `Not filing anything: N failed case(s) are not ready` | A failure report has no steps, no actual result or a bad severity | Add the missing fields to that result in the results file |
| `Set the TESTRAIL_API_KEY environment variable` (or another name) | A credential is not set | Set it in the shell; there is no option for it |
| `--base-url must use https` | The address is plain http to another host | Use the https address, or http://localhost for the mock |
| `HTTP 400: Field :run_id is not a valid test run` | The run number is wrong or the run is closed | Check the run in TestRail |
| `Stopped at ... issue(s) filed` | Jira refused one request part way | Fix the cause, then run again with the `--out` file; cases with keys are skipped |
| `ERR_UNKNOWN_FILE_EXTENSION` for `.ts` | An old Node that cannot run .ts files | Use Node 24 or later |

## Development

```bash
npm ci
npm test            # 128 tests
npm run demo        # stage 2 flow against the local mock
npm run validate
npm run validate:broken   # exits 1 on purpose
npx tsc -p tsconfig.json --noEmit   # from the repo root: npm run typecheck
```

The screenshots are real command output, captured by [`scripts/screenshots/terminal.mjs`](../../scripts/screenshots/terminal.mjs): `cd scripts/screenshots && npm run terminal -- coverage plan validate-broken integration-demo kit-tests`.
