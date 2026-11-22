# Release plan status: 1.4.1

As of 2026-11-22.

**5 of 6 tasks done.** The plan has no problems.

## Late

- Nothing is late.

## Open risks

| Risk | Severity | Owner | Mitigation |
|---|---|---|---|
| K2: A partner integration goes live the same day, so there is no waiting period. | high | Release manager | Release it as an emergency change with a review owed within 5 days. |
| K1: The discount code path has only the smoke checks so far, not the full regression suite. | medium | QA lead | Run the discount tests again on staging after the release. |

## Problems in the plan

- None.

## Tests to rerun for this release

DS-01, DS-02, DS-03, PF-01, PF-02, PL-01, PL-02

## Dependency map

```mermaid
flowchart LR
  n0["T1: Fix the two responses that did not match the API description (done)"]
  n1["T2: Run the API contract check again (done)"]
  n2["T3: Run the smoke and performance checks (done)"]
  n3["T4: Close the open high defect and review the rest (done)"]
  n4["T5: Walk the product owner through the known risks (done)"]
  n5["T6: Release gate decision"]
  n0 --> n1
  n0 --> n2
  n0 --> n3
  n1 --> n4
  n3 --> n4
  n1 --> n5
  n2 --> n5
  n4 --> n5
  style n0 fill:#dafbe1,stroke:#116329,color:#116329
  style n1 fill:#dafbe1,stroke:#116329,color:#116329
  style n2 fill:#dafbe1,stroke:#116329,color:#116329
  style n3 fill:#dafbe1,stroke:#116329,color:#116329
  style n4 fill:#dafbe1,stroke:#116329,color:#116329
```
