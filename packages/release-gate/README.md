# release-gate

Decides whether a release can go out. It reads the results of earlier checks (smoke tests, the API contract check, the k6 performance run), applies a policy, and returns **GO** or **NO-GO** with the reasons. The [Release workflow](../../.github/workflows/release.yml) only runs its deploy job on GO. It also writes a one-page [go / no-go memo](#the-go--no-go-memo) for a reader who does not read test reports, a [drift check](#the-release-drift-check) flags a release whose numbers moved more than normal noise, and [build promotion](#build-promotion-gated-on-smoke) only points the release tag at an image that passed smoke. A release can also carry an [ITIL change type](#itil-change-types) (standard, normal or emergency), and a [readiness page](#the-release-readiness-page) shows the whole picture in one place.

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

## ITIL Change Types

ITIL sorts changes by how much care they need. The gate now knows three:

| Type | Approval | Wait before release | Owed afterwards |
|---|---|---|---|
| Standard | none (pre-approved, low risk) | none | nothing |
| Normal | an approver is named | 24 hours after the request | nothing |
| Emergency | an approver is named, and the reason it cannot wait | none | a review within 5 days |

**An emergency change skips the wait, never the tests.** Every check still has to pass: a failed contract check is NO-GO whatever the change type. The change type only adds its own rules, and a broken one (no approver, a wait that is too short, no reason) blocks the release like a failed check, under the name `change-control`.

Add a `change` block to the release file:

```json
"change": {
  "type": "emergency",
  "requestedAt": "2026-11-22T08:00Z",
  "plannedFor": "2026-11-22T10:00Z",
  "approvedBy": "Release manager",
  "reason": "The partner integration goes live today, so the release cannot wait the usual day."
}
```

The memo gets a "Change type" section in plain words, with who approved and what is owed. The waits and the review period are policy settings (`changeTypes` in `gate.policy.json`); without them the table above applies. A release file with no `change` block works exactly as before, unless the policy sets `"requireChange": true`: then a release with no change type is blocked. A `change` block that cannot be read (an unknown type, a date that does not exist) is a failed `change-control` check in the table, with the reason.

---

## The Release Readiness Page

One generated page per release, built from files the repo already has, so it is a view and not another manual report. It shows the decision and the reasons, each check, every requirement with its tests, open defects by severity, quarantined tests, the dependency audit and ZAP results, and the change type with any review that is owed.

The page cannot disagree with the gate. Three readiness checks go through the same gate as the smoke tests:

| Check | Blocks when |
|---|---|
| `requirements` | A requirement has a failing test, or no passing test (a quarantined test is not evidence) |
| `open-defects` | More open defects than the limit for a severity (default: no open critical or high; `maxOpenDefects` in the policy changes it) |
| `security` | The dependency audit or the ZAP baseline failed or was not reported |

A readiness file that is missing or has a wrong field fails the gate with its own `readiness` check, so nothing is quietly skipped.

| Page | Decision | Why |
|---|---|---|
| [1.4.0](examples/pages/1.4.0.html) | NO-GO | the contract check, a failing requirement and one open high defect |
| [1.4.1](examples/pages/1.4.1.html) | GO | the same release after the fixes, as an emergency change with a review owed |

```bash
node src/cli.js --policy examples/policy-readiness.json --version 1.4.1 \
  --playwright smoke-tests=smoke.json --check api-contract=contract.json --k6 performance=performance.json \
  --release examples/release-1.4.1.json --memo memo.md \
  --readiness examples/readiness-1.4.1.json --page readiness.html
```

The page is one file with no scripts or outside links, readable on a phone, and every word from the input files is escaped. `--today 2026-11-22` makes it flag an owed review that is late; without it the page gives no verdict on that.

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

## Build Promotion Gated on Smoke

A release should be the exact thing that was tested, not a rebuild of it. The image is built once and pushed with a `staging` tag. Smoke runs against that image, started by its digest from the registry. Only when smoke passes does the `release` tag move to the same digest. A red smoke run leaves `release` where it was.

| Step | What is checked |
|---|---|
| Build and push | One build; the registry gives back the image digest |
| Smoke | The container is started from `repo@digest`, never from a tag, and the container's own image name is compared with that digest |
| Re-tag | The registry copies the manifest, byte for byte, so the digest cannot change |
| After | The `release` digest must equal the tested digest, or the run stops with an error |

The real proof is `npm run test:promotion`, which runs in CI as the `release-gate-promotion` job: a registry in Docker, the real qa-practice-api image and its real smoke tests. In the green run the `release` tag ends on the tested digest. In the red run the API container starts with a wrong admin password, the smoke run fails, and the `release` tag stays on the older image.

```bash
node src/promote-cli.js --registry localhost:5000 --repo qa-practice-api \
  --context ../qa-practice-api --smoke "npx playwright test --grep @smoke" --smoke-cwd ../qa-practice-api \
  --container-env ADMIN_EMAIL=admin@qa-practice.test --container-env ADMIN_PASSWORD=...
```

Exit 0 when promoted, 1 when smoke failed, 2 on bad arguments. The registry in CI is a throwaway container, so nothing is published; to use GitHub's container registry, point `--registry` at `ghcr.io/<owner>` and sign in first.

---

## Tests

```bash
npm test                  # 116 tests, no Docker needed
npm run test:promotion    # 2 tests with a real registry, image and smoke run (Docker must be running)
```

The adapter tests use a real Playwright smoke report and a real k6 summary. Each policy rule is tested in both directions, including a policy that allows a failure. The memo and drift tests each had a deliberate break put back once to show a test fails; the change type and readiness page code had 31 (for example a wait that is one hour short, an emergency that overrides a failed check, a page that ignores the gate, an unescaped title), and each failed a test.
