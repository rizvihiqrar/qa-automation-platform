# Defect log: HR and payroll conversion

[← Back to overview](../README.md) · [Test plan](../docs/test-plan.md) · [Readiness](../docs/readiness-go.md)

As of mock cycle 3 and payroll parallel run 2. Built by `python -m hcm_conv readiness` from the cycles and the payroll parallel runs, not typed by hand; a test fails when this file is not what the code builds.

**24 defects: 0 open, 21 closed, 3 accepted.**

| ID | Kind | Description | Where | Found by | Found in | Owner | Status | Resolution | Closed in |
|---|---|---|---|---|---|---|---|---|---|
| D-01 | missing required field | Last name is blank | `workers.csv 065316 last_name` | `REQUIRED` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-02 | missing required field | Last name is blank | `workers.csv 039249 last_name` | `REQUIRED` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-03 | missing required field | Hire date is blank | `workers.csv 013008 hire_date` | `REQUIRED` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| D-04 | bad date | 31 February does not exist | `workers.csv 084919 hire_date` | `DATE_INVALID` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-05 | bad date | Day-first date, not YYYY-MM-DD | `workers.csv 079814 hire_date` | `DATE_INVALID` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-06 | bad date | Terminated 30 days before the hire date | `workers.csv 011333 termination_date` | `DATE_ORDER` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| D-07 | duplicate ID | Same employee ID on two rows (a rehire entered twice) | `workers.csv 079697 employee_id` | `DUPLICATE_ID` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-08 | duplicate ID | Same employee ID on two rows (a rehire entered twice) | `workers.csv 079885 employee_id` | `DUPLICATE_ID` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| D-09 | mismatched totals | Trailer says 201 records; the file has 200 | `workers.csv TRAILER count` | `CONTROL_TOTAL` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-10 | mismatched totals | Gross is 0.01 more than the sum of its earnings lines | `payroll.sql 079263/P2026-20 gross` | `PAY_TOTAL` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-11 | mismatched totals | Net is 25.00 less than gross minus deductions | `payroll.sql 098486/P2026-20 net` | `PAY_TOTAL` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| D-12 | orphaned position | Organization ORG-99 does not exist | `positions.csv POS-0199 org_id` | `REF_ORG` | Cycle 1 | HR data owner | Accepted | Accepted from cycle 3: Vacant position in a closed organization; not converted (signed off by HR data owner) |  |
| D-13 | orphaned position | Organization ORG-21 does not exist | `positions.csv POS-0200 org_id` | `REF_ORG` | Cycle 1 | HR data owner | Accepted | Accepted from cycle 3: Vacant position in a closed organization; not converted (signed off by HR data owner) |  |
| D-14 | orphaned position | Position POS-9999 does not exist | `workers.csv 075936 position_id` | `REF_POSITION` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| D-15 | lost leading zeros | Employee ID 084284 lost its leading zeros | `compensation.csv 84284 employee_id` | `ID_FORMAT` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| D-16 | lost leading zeros | Employee ID 015674 lost its leading zeros | `compensation.csv 15674 employee_id` | `ID_FORMAT` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-17 | garbled accented name | Accented name double-encoded (UTF-8 read as Windows-1252) | `workers.csv 031766 first_name` | `ENCODING` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-18 | garbled accented name | Accented name double-encoded (UTF-8 read as Windows-1252) | `workers.csv 097830 last_name` | `ENCODING` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| D-19 | invalid code | Pay frequency 2W is not in the mapping table | `compensation.csv 001800 pay_frequency` | `CODE_UNKNOWN` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 2 (fixes/cycle2.yaml) | Cycle 2 |
| D-20 | invalid code | Country CAN is not in the mapping table (CA expected) | `workers.csv 095572 country` | `CODE_UNKNOWN` | Cycle 1 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| N-01 | late change | position_id is blank (a row that arrived after cycle 1) | `workers.csv 099501 position_id` | `REQUIRED` | Cycle 2 | HR data owner | Closed | Fixed in the legacy data before cycle 3 (fixes/cycle3.yaml) | Cycle 3 |
| PP-01 | payroll setup | Semimonthly is 24 pay periods a year, not 26 | `pay_groups.Semimonthly.periods_per_year` | `Every difference is explained` | Parallel run 1 | Payroll manager | Closed | Setup change before run 2: pay_groups.Semimonthly.periods_per_year = 24 | Parallel run 2 |
| PP-02 | payroll setup | Overtime was not attached to the Weekly pay group | `pay_groups.Weekly.earnings` | `Every difference is explained` | Parallel run 1 | Payroll manager | Closed | Setup change before run 2: pay_groups.Weekly.earnings = REG, OT | Parallel run 2 |
| EX-01 | known difference | The new engine rounds half a cent up; the legacy system rounded it to the even cent | `rounding` | `Explained differences are rounding sized` | Parallel run 1 | Payroll manager | Accepted | Proven by a replay with rounding = half_even: 118 differences in run 2 (signed off by Payroll manager) |  |
