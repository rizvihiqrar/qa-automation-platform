# release-gate

Decides whether a release can go out. It reads the results of earlier checks (smoke tests, the API contract check, the k6 performance run), applies a policy, and returns **GO** or **NO-GO** with the reasons. The [Release workflow](../../.github/workflows/release.yml) only runs its deploy job on GO.

**In plain English:** a release gate is the automated "are we sure?" before shipping. Instead of someone reading several test reports, the gate reads them, applies agreed rules, and blocks the release with a clear reason when a rule is broken.

---

## Example

```
## Release gate for 1.4.0: ⛔ NO-GO

| Check | Result | Detail |
|---|---|---|
| smoke-tests | pass | 10/10 passed, 0 failed, 0 flaky |
| api-contract | fail | 18/20 responses match the spec |
| performance | pass | 6/6 thresholds met |

**Blocking:**
- api-contract: 18/20 responses match the spec
```

In GitHub Actions the same table goes into the job summary.

---

## Policy

`gate.policy.json`:

```json
{
  "requiredChecks": ["smoke-tests", "api-contract", "performance"],
  "maxFailedTests": 0,
  "maxFlakyTests": 1
}
```

| Rule | Blocks when |
|---|---|
| Required checks | A listed check has no result (it didn't run, or its file is missing) |
| `maxFailedTests` | More tests failed than allowed |
| `maxFlakyTests` | More tests passed only on retry than allowed |
| No tests | A test suite ran zero tests, or a test file failed to load |
| Performance | Any k6 threshold was missed (the report names it) |
| Other checks | The check reported `passed: false` |

Test results are judged against the limits, not "any failure", so a team that allows one known failure can say so in the policy.

---

## Inputs

| Flag | Reads |
|---|---|
| `--playwright name=file` | Playwright JSON reporter output |
| `--k6 name=file` | k6 summary JSON (from `handleSummary`) |
| `--check name=file` | Any `{ "passed": true/false, "summary": "..." }`, e.g. `api-drift-checker --json` |

```bash
node src/cli.js --policy gate.policy.json --version 1.4.0 \
  --playwright smoke-tests=smoke.json \
  --check api-contract=contract.json \
  --k6 performance=performance.json
```

Exit code 0 on GO, 1 on NO-GO, 2 on bad arguments.

---

## The Release Workflow

`Release` (run it from the Actions tab with a version number):

1. **Verify and gate:** runs the qa-practice-api smoke tests, the API contract check and a k6 smoke test, then the gate. The checks are allowed to fail so the gate always gets to decide.
2. **Deploy to staging:** runs only if the gate said GO. The deployment is **simulated**: this portfolio has no real environment, so the step only records the deployment.

---

## Tests

```bash
npm test   # 15 tests
```

The adapter tests use a real Playwright smoke report and a real k6 summary. Each policy rule is tested in both directions, including a policy that allows a failure.
