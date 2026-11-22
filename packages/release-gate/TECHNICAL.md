# release-gate: technical guide

[← Back to overview](README.md)

**Contents:** [Memo](#memo) · [Change types](#change-types) · [Readiness page](#readiness-page) · [Plan check](#plan-check) · [Drift check](#drift-check) · [Build promotion](#build-promotion) · [How the noise limit was chosen](#how-the-noise-limit-was-chosen) · [Configuration](#configuration) · [CI integration](#ci-integration) · [FAQ](#faq) · [Troubleshooting](#troubleshooting) · [Development](#development)

## Memo

`src/memo.js` has two functions. `validateRelease` checks the hand-written release file and names the field that is wrong. `formatMemo` takes the gate outcome and the release file and returns the Markdown.

```json
{
  "version": "1.4.0",
  "date": "2026-11-20",
  "summary": "One or two plain sentences.",
  "changes": ["What changed, one line each (at least one)."],
  "risks": ["Known risks; the list may be empty."],
  "readyWhen": ["Only for a NO-GO: what has to happen first."],
  "madeReady": "Only for a GO that follows a NO-GO: what fixed it.",
  "signOff": ["Roles that sign (at least one)."]
}
```

| Rule | Why |
|---|---|
| A `decision` field is refused | A memo must never say GO when the gate said NO-GO; the gate is the only source |
| `risks` must be present | An empty list prints "None known at the time of the decision", so a missing field cannot pass for "no risks" |
| `readyWhen` shows only on a NO-GO, `madeReady` only on a GO | The memo reads as one story for each decision |
| Status words are plain: Passed, Failed, Did not run | The reader is not an engineer |

`examples/build-memos.js` builds the two example memos from the example inputs. `test/memo.test.js` fails when a committed memo no longer matches what the code builds, so the documentation cannot drift from the tool.

## Change types

`src/change.js` holds the rules. `validateChange` checks the `change` block of the release file and names the field that is wrong. `evaluateChange` applies the rules of the type and returns the problems and what is owed. `applyChange` adds the result to the gate outcome as a `change-control` check. `reviewStatus` says whether an owed review is due, late or done.

| Type | Defaults (`DEFAULT_CHANGE_TYPES`) |
|---|---|
| standard | no approval, no wait, no reason, no review |
| normal | approval, 24 hour wait |
| emergency | approval, a reason, no wait, review within 5 days |

`gate.policy.json` may set `changeTypes` per type (`needsApproval`, `waitHours`, `needsReason`, `reviewWithinDays`); a type that is not mentioned keeps its defaults.

| Rule | Why |
|---|---|
| `applyChange` never touches the checks | A change type adds a rule; it can never turn a failed check into a pass, so an emergency is faster, not looser |
| Times need a date, a time and a zone | "Nov 3" or a date with no zone would make the wait a guess; the wait is counted in real time across zones, and hours, minutes and offsets are range-checked |
| `type` is looked up with `Object.hasOwn` | A type named `toString` or `__proto__` is refused, not found on the object |
| The review is owed from the planned release time | The due day itself is not late; `reviewStatus` takes today's date as an argument so a test never depends on the clock |
| A change block that cannot be read is a failed `change-control` check | The table and the memo say why and the exit code is 1; before this the error went only to stderr and the table looked clean |
| Policy settings are checked | `waitHours: "24h"` or a misspelt setting is refused with its name, so a typo cannot switch a rule off without a sound |
| `requireChange` | With `"requireChange": true` in the policy, a release file with no change block (or a run with no release file) is blocked; without it the gate leaves such a release alone |
| A review dated before the release is a problem | `reviewDoneOn` cannot satisfy the owed review if it comes first |
| A date that does not exist is refused | `2026-02-31` is not rolled over to March; the day is written back out and compared |

## Readiness page

`src/readiness.js` has three parts. `validateReadiness` checks the readiness file. `fromReadiness` turns it into the three checks `requirements`, `open-defects` and `security`, which `decide()` judges like any other check. `formatPage` writes the HTML from the gate outcome and the same file.

```json
{
  "requirements": [{ "id": "REQ-1", "title": "...", "tests": [{ "id": "PL-01", "status": "pass" }] }],
  "defects": [{ "id": "DEF-1", "title": "...", "severity": "high", "status": "open" }],
  "security": { "audit": { "status": "pass", "detail": "..." }, "zap": { "status": "pass", "detail": "..." } }
}
```

Test status is `pass`, `fail` or `quarantined`; severity is `critical`, `high`, `medium` or `low`.

| Rule | Why |
|---|---|
| The banner comes from the gate outcome | The page is a view; a test builds a page for a failed smoke run with every readiness check clean and expects NO-GO |
| A quarantined test is not evidence | A requirement covered only by a quarantined test counts as not tested |
| A scan that was not reported fails | Silence must not read as a pass |
| Every text from the files is escaped | A title with `<script>` is shown as text; one test covers the id, title, detail, version and date fields |
| A bad or missing readiness file is a failed `readiness` check | The decision is still made and still says why; no page is written and the exit code is 2 |
| Ids must be unique, `security` must be an object | Two defects named D-1 would print as one ambiguous line; an array would pass for a result |
| `--today` is optional | Without it the page gives no verdict on a late review; the committed examples fix it at 2026-11-22 so they do not change with the clock |

The page has no data of its own to keep up to date: `examples/build-memos.js` builds both example pages and both memos, and the tests fail when a committed file differs from what the code builds.

## Plan check

`src/plan.js` has four parts. `validatePlan` checks the shape of the plan file and names the field that is wrong. `checkPlan` returns the problems, each with a code a test can pin (for example `cycle`, `raci-many-accountable`, `risk-no-owner`). `fromPlan` turns the problems into the `release-plan` check for the gate. `formatPlanReport` writes the status report, and `testsToRerun` lists the tests the changes touch, once each.

```json
{
  "release": "1.4.1", "releaseTask": "T6", "roles": ["Developer", "QA lead", "Release manager"],
  "tasks": [{ "id": "T1", "name": "...", "dueDate": "2026-11-20", "status": "done", "dependsOn": [], "raci": { "Developer": "R", "Release manager": "A" } }],
  "decisionPoints": [{ "id": "D1", "name": "Go or no-go", "date": "2026-11-22", "decidedBy": "Release manager", "successMeasure": "..." }],
  "risks": [{ "id": "K1", "text": "...", "severity": "high", "status": "open", "owner": "QA lead", "mitigation": "...", "linkedTests": ["DS-01"] }],
  "changes": [{ "id": "C1", "name": "...", "tests": ["DS-01"], "features": ["orders"] }]
}
```

| Rule | Why |
|---|---|
| Every task but the release must be upstream of the release task | A task nothing waits for usually means a dependency was forgotten |
| Exactly one accountable role per task | Two means nobody is; none means nobody is |
| Closed risks are not checked | A closed risk is history, so it does not need an owner |
| The release task may be open | It is the decision being made; every other task must be done |
| `late` needs `--today` | Without a date an open task is only `not-done`; a test passes the date in, so it never depends on the clock |
| Risk links are checked only when the readiness file is given | The test and defect ids come from it; with no list there is nothing to compare |
| A bad or missing plan file is a failed `release-plan` check | The decision is still made and says why; no report is written |
| A quote or a line break in a name cannot break the diagram, a pipe cannot break the risk table | Names are free text from the file |

The seeded set is in `test/plan.test.js`: each of the 23 faults is a small function that changes the good plan once, and the test names the code that has to appear. `examples/plans/status-1.4.1.md` is built by `examples/build-memos.js` and a test fails when it differs from what the code builds.

## Drift check

`src/drift.js` turns a Playwright JSON report (or a k6 summary) into a few numbers, builds a baseline from the history, and compares one run with it.

```js
// For each metric in the history
const mid = median(values);
const spread = 1.4826 * median(values.map((v) => Math.abs(v - mid))); // scaled median absolute deviation
const limit = mid + Math.max(6 * spread, 0.15 * mid);                   // for a "slower" metric
```

The median and the median absolute deviation are used instead of the mean and standard deviation because one slow run (the machine was busy) would otherwise stretch the limit.

| Kind | Metrics | Alert when |
|---|---|---|
| slower | whole run, slowest test, median test, k6 p95, k6 average | above the limit |
| exact | tests run | different from the median |
| count | failed, flaky, k6 failed request rate | above the largest value in the history |

A history with fewer than 10 runs is refused (`baseline` throws) and the command only fills it. `--record` adds a run to the history only when it is clean, so a bad release does not become the new normal.

## How the noise limit was chosen

I ran the 11 `@smoke` tests of qa-practice-api 20 times on one Windows PC while doing other work, so the timing noise is real and larger than CI's. Whole-run time ranged from 5.4 to 15.8 seconds.

| Setting | False alerts on the real runs | Slowdown caught (leave one out) |
|---|---|---|
| 5 past runs minimum, 6 spreads | 3 of 15 | not measured: the limit from 5 runs was too narrow |
| 10 past runs minimum, 6 spreads (used) | 0 of 20 | 2 times: 6 of 20, 3 times: 10 of 20, 4 times: 15 of 20, 5 times: 20 of 20 |
| 10 minimum, 4 spreads | 2 of 20 | 2 times: 10 of 20 |

The 5-run minimum was the first setting and gave false alerts, so it was raised to 10. The chosen setting never cries wolf on this data, at the price of missing small slowdowns. Counts (failed, flaky, tests run) have no noise, so any change alerts.

## Build promotion

Four files, so that the rules can be tested without Docker and the real thing can be tested with it.

| File | Job |
|---|---|
| `src/promote.js` | The rules: build, smoke on the digest, re-tag only on green, check the digest afterwards. Every step is passed in |
| `src/registry.js` | Two registry HTTP calls: the digest a tag points to (`HEAD`), and re-tag (`GET` the manifest by digest, `PUT` the same bytes under the new tag) |
| `src/docker-steps.js` | The real steps: `docker build` and `push`, remove the local copy, `docker run repo@digest`, wait for `/health`, run the smoke command with `BASE_URL` set |
| `src/promote-cli.js` | The command and the job summary |

```js
const before = await digestOf('release');
const tested = await build();                 // sha256:..., the digest in the registry
const result = await smoke(tested);           // runs repo@sha256:..., never :staging
if (!result.passed) { /* release must still equal before, or throw */ }
await retag(tested, 'release');
if ((await digestOf('release')) !== tested) throw new Error('...');
```

Why a registry-side re-tag and not `docker tag` and `docker push`: a push can rewrite the manifest (a different image store or builder gives a different digest). Copying the manifest bytes makes "the deployed image equals the tested image" true by construction, and the final digest comparison catches a registry that does something else.

Why the local copy is removed before the run: with the image still on the machine, `docker run repo@digest` would use it and the registry would never be read. Without it the container can only start from what the registry holds.

The qa-practice-api [Dockerfile](../qa-practice-api/Dockerfile) has production dependencies and `src` only. Settings (port, admin account, database) come from the environment when the container starts.

## Configuration

| Option | Default | What it does |
|---|---|---|
| `spreads` | 6 | How many typical spreads above the median still count as noise |
| `minRelative` | 0.15 | A change under this share of the median is never drift |
| `minSamples` | 10 | Past runs needed before a limit is set |

## CI integration

The `release-gate` job runs `npm test` (165 tests) and the `release-gate-promotion` job runs `npm run test:promotion` (2 tests, about a minute and a half) in the [CI workflow](../../.github/workflows/ci.yml). The Release workflow still runs the gate on every manual release; it does not build images.

## FAQ

### Why not put the drift check inside the gate rules?
The gate is a yes or no on fixed rules. Drift needs a history, so it runs on its own and hands the gate a `{ passed, summary }` file (`--json`), which the gate reads with `--check drift=...`.

### Why not push to GitHub's container registry in CI?
It would publish an image under the account, and the package visibility is a repository setting. The registry in CI is a container that disappears with the job; the promotion rules and the digest checks are the same. Only the `--registry` value changes.

### Why are the memo examples about a made-up release?
The portfolio has no product releases. The inputs are real (a Playwright smoke report, a k6 summary) and the gate decision is computed from them; only the change list and the sign-off roles are written by hand.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `release file: "date" must be a non-empty string` | A required field is missing | Add the field named in the message |
| `at least 10 are needed to know what normal is` | The history is too short | Add real runs with `--record` |
| Drift alerts on a slow machine | The history came from a faster one | Record runs from the same kind of machine |
| `docker run` cannot start the image or health never answers | The admin account or port settings are missing from `--container-env` | Pass the same `ADMIN_EMAIL` and `ADMIN_PASSWORD` the smoke tests sign in with |
| A committed memo, page or report test fails | The memo, page or plan code or an example input changed | `node examples/build-memos.js` and commit the new files |
| `release file: change.plannedFor must be a date and time` | The time has no zone or no time of day | Write it as `2026-11-20T09:00Z` |
| `release-plan: ... has nobody accountable` | A task has no A in its RACI row, or two | Give the task exactly one accountable role |
| `change-control: a normal change waits 24 hours` | The release is planned too soon after the request | Move `plannedFor` later, or make it an emergency change with an approver and a reason |

## Development

```bash
npm test                                 # 165 tests
npm run test:promotion                   # 2 tests: real registry, image and smoke run
node examples/build-memos.js             # rewrite the example memos, pages and plan report
node src/drift-cli.js --history drift/history.json --playwright smoke.json --label run-21 --record
```
