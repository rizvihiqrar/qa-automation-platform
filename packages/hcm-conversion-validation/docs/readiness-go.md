# Go or no-go readiness: HR and payroll conversion

[← Back to overview](../README.md) · [Test plan](../docs/test-plan.md) · [Defect log](../docs/defect-log.md) · [Traceability](../docs/traceability.md)

Checkpoint: mock cycle 3 and payroll parallel run 2. Built by `python -m hcm_conv readiness`: the exit criteria of the test plan, each checked against evidence worked out again. Every one must pass.

## Decision: GO

| # | Exit criterion | Result | Evidence |
|---|---|---|---|
| 1 | No open exception, and every accepted one signed off | PASS | cycle 3: 0 open, 2 accepted |
| 2 | Every reconciliation check passes | PASS | cycle 3: 8 of 8 pass |
| 3 | The payroll parallel explains every difference | PASS | run 2: 0 unexplained, 118 explained; 4 of 4 pass |
| 4 | Every masking check passes | PASS | 5 of 5 pass |
| 5 | Every fault scenario passes | PASS | 6 of 6 fault scenarios passing |
| 6 | Every requirement has tests, and all of them passed | PASS | 63 of 63 requirements passing |
| 7 | Every logged defect is closed or accepted | PASS | 24 defects: 0 open, 21 closed, 3 accepted |

## Signed off

- D-12: Accepted from cycle 3: Vacant position in a closed organization; not converted (signed off by HR data owner)
- D-13: Accepted from cycle 3: Vacant position in a closed organization; not converted (signed off by HR data owner)
- EX-01: Proven by a replay with rounding = half_even: 118 differences in run 2 (signed off by Payroll manager)

Criteria 5 and 6 here come from every requirement of the test plan passing, as in a green CI run. CI checks them for real on every run: the `hcm-conversion-validation-traceability` job builds this report from both suites' JUnit files and fails on NO-GO.
