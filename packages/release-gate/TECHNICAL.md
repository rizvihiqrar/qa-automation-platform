# release-gate: technical guide

[← Back to overview](README.md)

**Contents:** [Memo](#memo) · [Drift check](#drift-check) · [How the noise limit was chosen](#how-the-noise-limit-was-chosen) · [Configuration](#configuration) · [CI integration](#ci-integration) · [FAQ](#faq) · [Troubleshooting](#troubleshooting) · [Development](#development)

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

## Configuration

| Option | Default | What it does |
|---|---|---|
| `spreads` | 6 | How many typical spreads above the median still count as noise |
| `minRelative` | 0.15 | A change under this share of the median is never drift |
| `minSamples` | 10 | Past runs needed before a limit is set |

## CI integration

The `release-gate` job runs `npm test` (53 tests) in the [CI workflow](../../.github/workflows/ci.yml). The Release workflow still runs the gate on every manual release.

## FAQ

### Why not put the drift check inside the gate rules?
The gate is a yes or no on fixed rules. Drift needs a history, so it runs on its own and hands the gate a `{ passed, summary }` file (`--json`), which the gate reads with `--check drift=...`.

### Why are the memo examples about a made-up release?
The portfolio has no product releases. The inputs are real (a Playwright smoke report, a k6 summary) and the gate decision is computed from them; only the change list and the sign-off roles are written by hand.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `release file: "date" must be a non-empty string` | A required field is missing | Add the field named in the message |
| `at least 10 are needed to know what normal is` | The history is too short | Add real runs with `--record` |
| Drift alerts on a slow machine | The history came from a faster one | Record runs from the same kind of machine |
| A committed memo test fails | The memo code or an example input changed | `node examples/build-memos.js` and commit the new memos |

## Development

```bash
npm test                                 # 53 tests
node examples/build-memos.js             # rewrite the two example memos
node src/drift-cli.js --history drift/history.json --playwright smoke.json --label run-21 --record
```
