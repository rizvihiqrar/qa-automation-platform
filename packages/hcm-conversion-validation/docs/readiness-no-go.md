# Go or no-go readiness: HR and payroll conversion

[← Back to overview](../README.md) · [Test plan](../docs/test-plan.md) · [Defect log](../docs/defect-log.md) · [Traceability](../docs/traceability.md)

Checkpoint: mock cycle 2 and payroll parallel run 1. Built by `python -m hcm_conv readiness`: the exit criteria of the test plan, each checked against evidence worked out again. Every one must pass.

## Decision: NO-GO

| # | Exit criterion | Result | Evidence |
|---|---|---|---|
| 1 | No open exception, and every accepted one signed off | **FAIL** | cycle 2: 12 open, 0 accepted; open: CODE_UNKNOWN, DATE_ORDER, DUPLICATE_ID, ENCODING, ID_FORMAT, PAY_TOTAL, REF_ORG, REF_POSITION, REQUIRED |
| 2 | Every reconciliation check passes | **FAIL** | cycle 2: 7 of 8 pass; failing: Every loaded worker has compensation |
| 3 | The payroll parallel explains every difference | **FAIL** | run 1: 690 unexplained, 94 explained; 3 of 4 pass; failing: Every difference is explained (the parallel pays from the cycle 3 load, the first that passes every check) |
| 4 | Every masking check passes | PASS | 5 of 5 pass |
| 5 | Every fault scenario passes | PASS | 6 of 6 fault scenarios passing |
| 6 | Every requirement has tests, and all of them passed | PASS | 63 of 63 requirements passing |
| 7 | Every logged defect is closed or accepted | **FAIL** | 24 defects: 13 open, 10 closed, 1 accepted; open: D-03, D-06, D-08, D-11, D-12, D-13, D-14, D-15, D-18, D-20, N-01, PP-01, PP-02 |

## What blocks go

- No open exception, and every accepted one signed off: cycle 2: 12 open, 0 accepted; open: CODE_UNKNOWN, DATE_ORDER, DUPLICATE_ID, ENCODING, ID_FORMAT, PAY_TOTAL, REF_ORG, REF_POSITION, REQUIRED
- Every reconciliation check passes: cycle 2: 7 of 8 pass; failing: Every loaded worker has compensation
- The payroll parallel explains every difference: run 1: 690 unexplained, 94 explained; 3 of 4 pass; failing: Every difference is explained (the parallel pays from the cycle 3 load, the first that passes every check)
- Every logged defect is closed or accepted: 24 defects: 13 open, 10 closed, 1 accepted; open: D-03, D-06, D-08, D-11, D-12, D-13, D-14, D-15, D-18, D-20, N-01, PP-01, PP-02

## Signed off

- EX-01: Proven by a replay with rounding = half_even: 94 differences in run 1 (signed off by Payroll manager)

Criteria 5 and 6 here come from every requirement of the test plan passing, as in a green CI run. CI checks them for real on every run: the `hcm-conversion-validation-traceability` job builds this report from both suites' JUnit files and fails on NO-GO.
