# release-gate

Decides whether a release can go out. It reads the results of earlier checks (smoke tests, the API contract check, the k6 performance run), applies a policy, and returns **GO** or **NO-GO** with the reasons. The [Release workflow](../../.github/workflows/release.yml) only runs its deploy job on GO. It also writes a one-page [go / no-go memo](#the-go--no-go-memo) for a reader who does not read test reports, and a [drift check](#the-release-drift-check) flags a release whose numbers moved more than normal noise.

**[Technical guide →](TECHNICAL.md)**

**Overview:** a release gate is the automated "are we sure?" before shipping. Instead of someone reading several test reports, the gate reads them, applies agreed rules, and blocks the release with a clear reason when a rule is broken.

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

## The Go / No-Go Memo

The gate answers for the pipeline. The memo answers for the person who signs off. It is one page: the decision, what changed, what was tested in plain words, why it is not ready (when it is not), the known risks and a sign-off table.

Two examples are committed, a release that was held back and the release that fixed it:

| Memo | Decision | Why |
|---|---|---|
| [1.4.0](examples/memos/1.4.0.md) | NO-GO | 18 of 20 responses matched the API description, and what had to happen first is listed |
| [1.4.1](examples/memos/1.4.1.md) | GO | The same release after the two mismatches were fixed, with a "What made it ready" section |

The decision, the checks and the reasons always come from the gate, never from the hand-written release file: a release file that tries to set a decision is refused.

```bash
node src/cli.js --policy gate.policy.json --version 1.4.0 \
  --playwright smoke-tests=smoke.json --check api-contract=contract.json --k6 performance=performance.json \
  --release examples/release-1.4.0.json --memo memo.md
```

---

## The Release Drift Check

A release can pass every rule and still be slower or shakier than the last ones. The drift check compares one run with the history of past runs and flags a metric that moved more than normal run-to-run noise. The limit is not a number picked by hand: it is the median of the past runs plus six typical spreads, and a metric that never moved gets a 15 percent floor.

| Watched | Judged how |
|---|---|
| Time for the whole run, the slowest test, the median test (and k6 p95 and average) | Alert when above the noise limit; faster is never drift |
| Tests run | Alert on any difference from the usual number |
| Failed and flaky tests, k6 failed request rate | Alert on anything above the most seen before |

Proof on real data: [drift/history.json](drift/history.json) holds 20 real smoke runs of qa-practice-api (11 tests each). Each run, checked against the other 19, raises no alert. A seeded slowdown (every time 5 times longer), a seeded failure, a lost test and a new flaky test raise an alert on all 20. The machine is noisy (a whole run took 5 to 16 seconds), so a slowdown of 2 times is caught in about a third of the runs and 3 times in about half: the check is for big moves and any change in counts, not small ones.

```bash
node src/drift-cli.js --history drift/history.json --playwright smoke.json --label 1.5.0 --json drift-result.json
# then give the gate: --check drift=drift-result.json
```

---

## Tests

```bash
npm test   # 53 tests
```

The adapter tests use a real Playwright smoke report and a real k6 summary. Each policy rule is tested in both directions, including a policy that allows a failure. The memo and drift tests each had a deliberate break put back once to show a test fails.
