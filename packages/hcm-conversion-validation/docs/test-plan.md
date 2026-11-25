# Test plan: HR and payroll conversion

[← Back to overview](../README.md) · [Traceability matrix](traceability.md)

**Contents:** [Overview](#overview) · [Scope](#scope) · [Approach](#approach) · [Environments and data](#environments-and-data) · [Schedule](#schedule) · [Roles](#roles) · [Entry criteria](#entry-criteria) · [Exit criteria](#exit-criteria) · [Requirements](#requirements) · [Defect management](#defect-management) · [Risks](#risks)

## Overview

This plan covers the move of 200 worker records, their positions, organizations, pay and the last three pay runs from a legacy HR and payroll system to a Workday-style target (a mock API in this project). It says what is tested, how, with what data, and what has to be true before the business can say go.

Every requirement below has an ID. Each test names the requirements it checks with a `req` marker, and the run refuses a test with no marker or an ID that is not in this plan. The [traceability matrix](traceability.md) is built from the test results: each requirement, its tests, and its latest result.

## Scope

| In scope | Out of scope |
|---|---|
| Mapping and validation of 5 legacy files and the payroll database | The target's own screens, security and workflows |
| The target's load rules, as far as the bulk load shows them | Real people's data (everything here is fake) |
| Reconciliation of what loaded against the source | Taxes by province or state (the engine uses flat rates) |
| Three mock conversion cycles, with fixes and signed-off exceptions | Performance at production size |
| A payroll parallel of the last three pay periods | Benefits, time off, recruiting and other HR areas |
| A masked copy of the extract for test tenants | Rollback of a live target |
| The loader on a bad network line | |

## Approach

| Level | What it shows | How |
|---|---|---|
| Rules | Each rule finds what it should and nothing else | 20 seeded defects with an answer key; each found by its own rule, no error outside the key |
| Target | The target refuses what it should | One good record per sheet, then one change per rule |
| Reconciliation | What loaded is what was sent | Counts, hash totals, a SHA-256 hash of every record, a rerun; each check broken on purpose by a target that trims, rounds, drops or copies |
| Cycles | Exceptions go down and the fixes close what they name | Three cycles into an empty tenant, deltas by rule, file, key and field |
| Parallel | The new system pays what the old one paid | Every pay line to the cent; each difference proven by a replay with a signed-off setting |
| Masking | Nobody real is left, and the copy still breaks the same rules | Five self-checks, each broken on purpose |
| Faults | A broken line never loads twice or hangs | Toxiproxy in Docker, one fault on one call |

Every fixed bug was put back once to show a test fails without the fix (the deliberate breaks in the [README](../README.md)).

## Environments and data

| Item | Value |
|---|---|
| Legacy extract | [legacy/](../legacy), generated from seed 51 (Faker fr_CA and en_CA), checked byte for byte on every run |
| Target | The mock API, in-process for the main suite; on a real port behind Toxiproxy 2.12.0 for the fault suite |
| CI | Job `hcm-conversion-validation` (Python only) and job `hcm-conversion-validation-faults` (Docker) |
| Results | `reports/junit.xml` and `reports/junit-faults.xml`, kept 7 days as CI reports |

## Schedule

| Step | Goes in with | Comes out with |
|---|---|---|
| Mock cycle 1 | The raw extract | The exception report: 22 open |
| Mock cycle 2 | Fixes for 10 defects, a late new hire | 12 open, 1 new |
| Mock cycle 3 | The remaining fixes, 2 signed-off exceptions | 0 open, every check passed |
| Payroll parallel run 1 | Cycle 3's target, the setup as built | 2 setup mistakes found |
| Payroll parallel run 2 | The 2 setup changes | Every difference explained |
| Readiness | All of the above and the test results | Go or no-go |

## Roles

| Role | Owns |
|---|---|
| HR data owner | Fixes to worker, position and organization data; signs off accepted exceptions |
| Payroll manager | The payroll setup; signs off explained differences |
| Conversion lead | The mapping, the loads and the cycle plan |
| QA | This plan, the tests, the [matrix](traceability.md), the [defect log](defect-log.md) and the readiness report |

## Entry criteria

- The legacy extract matches its generator byte for byte (LX-01).
- The answer key lists every seeded defect (LX-02).
- The target accepts a good template on every sheet (TR-01).

## Exit criteria

The go or no-go decision. Every item must hold; there is no tolerance. The [readiness report](readiness-go.md) checks each one (QR-05); a [NO-GO example](readiness-no-go.md) shows the checkpoint after cycle 2 and parallel run 1.

1. No open exception after the last cycle; each accepted one names who signed it off.
2. Every reconciliation check passes: counts, hash totals, row hashes and the rerun.
3. The last payroll parallel run has no unexplained difference, and every explained one is rounding sized.
4. Every masking check passes.
5. Every fault scenario passes.
6. Every requirement in this plan has at least one test, and all of its tests passed.
7. Every logged defect is closed or accepted.

## Requirements

The third column names the rule or the check, exactly as the code reports it. A test checks that each name here is one the code really uses.

### Legacy extract

| ID | Requirement | Rule or check |
|---|---|---|
| LX-01 | The extract is rebuilt byte for byte from seed 51, at the sizes the docs give | |
| LX-02 | Twenty seeded defects of eight kinds are in the answer key, each on a line that shows it | |
| LX-03 | The data is fake, and real accents sit beside the garbled ones | |

### Mapping and validation rules

| ID | Requirement | Rule or check |
|---|---|---|
| MR-01 | A required field that is blank after trimming holds its row back | `REQUIRED` |
| MR-02 | An ID that is not 6 digits holds its row back (lost leading zeros) | `ID_FORMAT` |
| MR-03 | A date that is not a real date written YYYY-MM-DD holds its row back | `DATE_INVALID` |
| MR-04 | An amount with more than 2 decimals, or not a number, holds its row back | `MONEY_INVALID` |
| MR-05 | A code that is not in its code table holds its row back | `CODE_UNKNOWN` |
| MR-06 | A name with double-encoded characters holds its row back | `ENCODING` |
| MR-07 | Two rows with the same key are both held back | `DUPLICATE_ID` |
| MR-08 | A termination before the hire date holds the worker back | `DATE_ORDER` |
| MR-09 | A position or organization under an organization that does not exist is held back | `REF_ORG` |
| MR-10 | A worker on a position that does not exist is held back | `REF_POSITION` |
| MR-11 | Compensation or pay for a worker not in the extract is held back | `REF_WORKER` |
| MR-12 | A trailer whose count or hash total does not match its file is reported | `CONTROL_TOTAL` |
| MR-13 | A pay result that does not add up to its lines, or has none, is held back | `PAY_TOTAL` |
| MR-14 | A row that needs a held row is held too, and names the row it waits for | `HELD_PARENT` |
| MR-15 | Legacy codes are turned into the target's codes as mapping.yaml says | |
| MR-16 | No error is raised outside the answer key | |

### Target load rules

| ID | Requirement | Rule or check |
|---|---|---|
| TR-01 | A good template loads every sheet, and validate-only saves nothing | |
| TR-02 | The target refuses a bad row with its reason and still loads the rest; rows that need a refused row are refused too | |
| TR-03 | Loading the same file again updates rows by key and adds nothing | |
| TR-04 | Lists page up to 100, reports export as JSON or CSV, the error report downloads as a spreadsheet, and a reset empties the tenant | |

### Reconciliation

| ID | Requirement | Rule or check |
|---|---|---|
| RC-01 | The target accepts every row sent, in validate-only and in the load; a refused row is a `TARGET_REJECTED` finding | `Target accepts every row sent` |
| RC-02 | For each record type, source = held + loaded + rejected, and the target holds what loaded | `Row counts balance` |
| RC-03 | The count and sum of worker IDs sent equal the target's | `Hash total: worker IDs` |
| RC-04 | The annual salary totals match | `Hash total: annual salaries` |
| RC-05 | Per pay period, count, gross and net match the legacy database | `Hash totals: pay per period` |
| RC-06 | Every loaded worker has compensation | `Every loaded worker has compensation` |
| RC-07 | Every record's hash equals the same record read back: a mismatch is a `RECON_MISMATCH` naming its field, a record not read back a `RECON_MISSING` | `Row hashes match` |
| RC-08 | Loading the same file again adds and changes nothing | `Rerun adds and changes nothing` |

### Cycles and exceptions

| ID | Requirement | Rule or check |
|---|---|---|
| CY-01 | Open exceptions fall from 22 to 12 to 0, and only cycle 3 passes every check | |
| CY-02 | Deltas match exceptions by rule, file, key and field, not by line | |
| CY-03 | Each seeded defect is fixed once or signed off, each fix closes the defect it names, and a fix that matches no row stops the run | |
| CY-04 | An accepted exception must match a real exception and name its reason and who signed it off | |
| CY-05 | Each cycle writes its exception workbook, keeping accents and leading zeros, and the command line sets its exit code | |

### Payroll parallel

| ID | Requirement | Rule or check |
|---|---|---|
| PA-01 | The new engine pays from its setup: regular pay, overtime only where the pay group has it, half a cent rounded up | |
| PA-02 | Every pay result has compensation in the target | `Every pay result has compensation in the target` |
| PA-03 | Every pay result was paid by the legacy system | `Every pay result was paid by the legacy system` |
| PA-04 | Every difference is explained by a signed-off setting that replays it exactly | `Every difference is explained` |
| PA-05 | No explained difference is larger than a cent per rounded line | `Explained differences are rounding sized` |
| PA-06 | Run 1 finds exactly the 2 setup mistakes, run 2 passes, and net pay per period differs by exactly the explained cents | |

### Masking

| ID | Requirement | Rule or check |
|---|---|---|
| MK-01 | Only the 5 personal columns of workers.csv change | `Only the personal columns changed` |
| MK-02 | No personal value is kept on its row | `No personal value is kept on its row` |
| MK-03 | No national ID or email appears anywhere in the masked files | `No national ID or email appears anywhere in the masked files` |
| MK-04 | Masked national IDs are unique and never a real one | `Masked national IDs stay unique` |
| MK-05 | The checks find the same problems in the masked copy | `The checks find the same problems in the masked copy` |
| MK-06 | Masked values keep their shape: blanks, accents, garbling, 9-digit IDs, birth dates in the same year | |
| MK-07 | Masking needs a key; the same key gives the same bytes and another key other values | |

### Loader

| ID | Requirement | Rule or check |
|---|---|---|
| LD-01 | A call that got no answer is tried up to 3 times with a doubling backoff, then fails naming the call and every error | |
| LD-02 | Only calls that are safe to send twice are retried, and an error status is never retried | |
| LD-03 | Every try and every retry is recorded | |

### Integration faults

| ID | Requirement | Rule or check |
|---|---|---|
| FS-01 | The fault line uses the pinned Toxiproxy image, and a load with no fault validates once and loads once | |
| FS-02 | A slow reply times out and the retry reads it again | |
| FS-03 | A reset in the middle of the upload is sent again and loads once | |
| FS-04 | A silent line ends in a timeout, not a hang | |
| FS-05 | A reply lost after the save is loaded again with no duplicates | |
| FS-06 | A fault that never clears fails loudly after 3 tries | |

### Quality records

| ID | Requirement | Rule or check |
|---|---|---|
| QR-01 | Every test traces to a requirement in this plan, and every requirement has a test | |
| QR-02 | Every rule and check named in this plan is one the code reports, and every one the code reports is named | |
| QR-03 | The traceability matrix shows each requirement with its tests and their latest results | |
| QR-04 | The defect log lists every defect with where it was found, what closed it and its status, worked out from the cycles and the parallel runs | |
| QR-05 | The readiness report checks every exit criterion against fresh evidence, and says go only when all of them pass | |

## Defect management

The [defect log](defect-log.md) is worked out from the evidence, not typed: each seeded defect from the answer key, each new exception that arrives in a later cycle (named by the fix that closes it), each payroll setup change, and each signed-off difference. A defect is:

| Status | When |
|---|---|
| Open | Its rule or check still reports it at the checkpoint |
| Closed | A later cycle or parallel run no longer reports it; the log names the fix |
| Accepted | The owner signed it off: an accepted exception (HR data owner) or an explained difference (payroll manager) |

Data defects belong to the HR data owner, payroll setup and differences to the payroll manager. Go needs every defect closed or accepted (exit criterion 7).

## Risks

| Risk | What lowers it |
|---|---|
| A rule finds the seeded defect but also flags good rows | MR-16: no error outside the answer key |
| Totals match while a field changed | RC-07: a hash of every record, each mismatch named by field |
| A pay gap is waved through as rounding | PA-04 and PA-05: a replay, and a cap of a cent per rounded line |
| The masked copy hides the bugs it was made to test | MK-05: the same 68 findings on both sides |
| A load is sent twice on a bad line | FS-05: the reply lost after the save, with the reconciliation after it |
| A test is added but checks nothing in this plan | QR-01: the run refuses a test with no requirement |
