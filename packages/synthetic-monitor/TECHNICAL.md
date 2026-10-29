[← Back to overview](README.md)

# synthetic-monitor: technical guide

## Contents

- [How it is built](#how-it-is-built)
- [What a check sees](#what-a-check-sees)
- [The rules](#the-rules)
- [Where the history lives](#where-the-history-lives)
- [Alerts](#alerts)
- [Configuration](#configuration)
- [CI integration](#ci-integration)
- [Results](#results)
- [Deliberate breaks](#deliberate-breaks)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## How it is built

```text
packages/synthetic-monitor
  src/sites.ts         the four sites: URL, expected title, expected element
  src/check.ts         one check: load the page, test title and element, retry once
  src/history.ts       the history file's shape and every rule (down, slow, uptime, 30-day cap)
  src/history-file.ts  read (a missing file is a first run, a broken one is an error) and write (temp file, then rename)
  src/monitor.ts       one run over a list of sites; throws MonitorBroken when every site fails
  src/run.ts           the command: browser, files, exit code
  src/alerts.ts        which issues to open and close (pure)
  src/alert.ts         carries that out with the gh CLI (gh is passed in, so tests use a fake)
  tests/unit/          32 checks of the rules, the files and the alert plan
  tests/browser/       24 checks (12 per browser) of the page check, against tests/fake-site.ts
  tests/fake-site.ts   a local site with one path for each way a site goes wrong
```

The rules are plain functions of the history: no clock, no network, no browser. Only `check.ts` opens a page, and only `run.ts` and `alert.ts` touch files or GitHub.

## What a check sees

A check passes only if all four hold, in a fresh browser context each time:

| Step | Fails when |
|---|---|
| `page.goto` with `waitUntil: 'load'` | no answer, a dropped connection, or no load inside 15 s |
| The response status | 400 or higher |
| The page title | does not match the site's expected title (a "down for maintenance" page that answers 200 fails here) |
| The element | not visible before the same 15 s deadline runs out (the element gets what the load left) |

The load time recorded is the time `goto` took to the `load` event. A failed first attempt waits 2 s and tries once more; the second attempt decides. A pass on the retry is recorded as up, with `attempts: 2`.

The tests drive this against `tests/fake-site.ts`, one path per case:

| Path | Behaviour | Expected result |
|---|---|---|
| `/ok` | normal page | up, 1 attempt |
| `/slow` | answers after 1.2 s | up, load time at least 1.1 s |
| `/500`, `/404` | error status | down, error names the status |
| `/wrong-title` | 200 with another title | down, error shows the title it saw |
| `/no-element` | right title, no element | down, timeout |
| `/hang` | never answers | down once the timeout passes |
| `/drop` | closes the connection | down |
| `/flaky-once` | 503 first, then fine | up, 2 attempts |
| `/flaky-always` | 503 every time | down, exactly 2 requests |

## The rules

| Rule | Value | Where |
|---|---|---|
| Down | 2 failed runs in a row (each run already tried twice) | `DOWN_AFTER` in `src/history.ts` |
| Degraded | 1 failed run: shown on the dashboard, never alerts | `summarize` |
| Slow | latest load more than 3 times the median of the site's earlier passing runs, with at least 10 of them | `SLOW_FACTOR`, `MIN_SAMPLES` |
| History kept | 30 days | `KEEP_DAYS` |
| Sparkline | last 48 runs (24 hours) | `SERIES_LENGTH` |

Slow is judged against the runs before the latest one, so a very slow load cannot raise the median it is judged by. Exactly 3 times is not slow. Each site has its own median, so a site that always takes 2 s is not slow at 2 s while a site that takes 100 ms is slow at 400 ms.

## Where the history lives

`history.json` (every run of the last 30 days) and `summary.json` (what the dashboard shows) sit on the `monitoring-data` branch, which holds a single commit that each run replaces. Why:

- Main stays free of monitoring commits.
- 48 commits a day would grow the branch without limit, and the 30 days are in the file, not in git.
- The history is read only when it exists: no file means a first run, but a file that cannot be read stops the run, because carrying on would overwrite 30 days with one entry.
- Files are written to a temporary name and renamed, so an interrupted write cannot leave half a file.

If every site fails in one run, the run is not saved and the workflow fails: the runner has no connection, so the failures say nothing about the sites.

## Alerts

`planAlerts` turns each site's status and the open `monitoring` issues into actions:

| Site status | No open issue | Open issue |
|---|---|---|
| down | open `Monitor: <site> is down` with the error, since when, uptime and a run link | nothing (no second issue) |
| degraded | nothing | nothing (stays open until the site passes) |
| up (slow or not) | nothing | close with a comment |
| not watched any more | n/a | close as no longer monitored |

The label is created with `gh label create --force` before the first issue, so the first outage cannot fail on a missing label. The issue title is the key, so do not retitle an open one.

## Configuration

| What | Where | Default |
|---|---|---|
| Sites, expected title and element | `src/sites.ts` | saucedemo, the-internet, playwright.dev, this repo's dashboard |
| Page timeout | `timeoutMs` in `src/check.ts` | 15 s for the load and the element together |
| Wait before the retry | `retryDelayMs` | 2 s |
| Browser | `BROWSER=firefox` for `npm run monitor` | chromium |
| Data folder | `--data <folder>` | `data` (git ignores it) |
| Repository for issues | `--repo owner/name` or `GITHUB_REPOSITORY` | none: it must be given |

## CI integration

Two workflows use the package. The tests run in the CI matrix like every other package:

```yaml
- { package: synthetic-monitor, browsers: true, browserList: chromium firefox, command: npm test }
```

The [Monitor workflow](../../.github/workflows/monitor.yml) is the scheduled one:

```yaml
on:
  schedule:
    - cron: '7,37 * * * *'   # off the hour: GitHub delays and drops runs queued at :00
  workflow_dispatch:
```

Each run installs the browser through the shared install script, checks out the data branch as a second working tree (or starts it empty the first time), runs the check, saves the history to `monitoring-data`, and then opens or closes issues. Saving comes before alerting, and alerting still runs if saving failed. One run at a time, 10-minute limit, and a fork does not run its own copy.

The [Dashboard workflow](../../.github/workflows/dashboard.yml) fetches `summary.json` from that branch and rebuilds every 3 hours as well as after CI, so the section is never more than 3 hours old. Its rule for "the monitor has stopped" is 90 minutes without a report, checked when the page is built.

[CI health](../../scripts/ci-health.mjs) watches Monitor: failing, or no run for 3 hours, is a problem. (The dashboard says "stopped" sooner, at 90 minutes, because it only asks whether the numbers on the page are fresh; CI health allows for GitHub delaying scheduled runs before it raises an issue.) [CI recheck](../../.github/workflows/ci-recheck.yml) re-runs a failed Monitor once. A down site is neither: it is a result and an issue.

The checks that keep this true are in [`scripts/monitor-workflow.test.mjs`](../../scripts/monitor-workflow.test.mjs) (15 of them: schedule and cron, no hidden failures, the only push goes to `monitoring-data`, save before alert, one commit, only a missing branch starts a history, the dashboard step) and in [`scripts/ci-health.test.mjs`](../../scripts/ci-health.test.mjs) (every scheduled workflow must be watched).

## Results

| Result | Number |
|---|---|
| Checks in CI | 56 (32 unit, 24 browser: 12 in each of Chromium and Firefox) |
| Real sites, first live run | 4 of 4 up: saucedemo 2.6 s, the-internet 0.4 s, playwright.dev 0.3 s, dashboard 0.1 s |
| Package tests, run 3 times in a row | green each time |

## Deliberate breaks

Each change below was made on purpose, a test failed, and the change was put back.

| Change | What failed |
|---|---|
| Down after 1 failed run instead of 2 | 3 unit tests |
| No 30-day cap | the cap test |
| Slow at 2 times the median | the slow test |
| Slow judged with its own run included | the median test |
| Issue never closed on recovery | 3 alert tests |
| Issue opened after one failed run | the degraded test |
| Issue opened for a slow site | the slow test |
| No retry inside the run | 10 of 12 browser tests in Chromium |
| "Every site failed" not detected | the monitor-broken test |
| An unreadable history file read as empty | the truncated-file test |
| Label not created before the first issue | the label test |
| A run with an unreadable time wiping the history | the bad-date test |
| The first run's median counting its own load | the first-run test |

The workflow checks have 11 more of their own (cancel-in-progress on, a push to main, a cron at :00 and :30, `|| true` on the run, a 60-minute limit, an extra permission, no amend, any failed lookup starting a new history, the alert step skipped after a failed save, no fork guard, a cron 38 minutes apart). The CI health checks have 2 (Monitor left off the watch list, a 30-hour limit). The dashboard section has 15 (stale limit, escaping, Slow always shown, a line not broken at a gap, one failed run shown as down, a missing time read as fresh, an unseen file published, an unknown status in red, the guarded fetch, the schedule, the `--monitoring` flag).

## FAQ

### Why a real browser and not a plain HTTP request?

A server can answer 200 with a maintenance page, or with a page whose script is broken. The title and the element prove the page a visitor would see.

### Why two failed runs, each tried twice?

One dropped connection from a hosted runner is common and says nothing about the site. Two attempts inside the run take care of that. A second failed run, 30 minutes later, means it is not a blip.

### Why is a slow site not an alert?

Load time on a shared runner varies a lot. The dashboard shows it and a person can look; an issue every time a site was slow would be ignored.

### Can it watch a site that needs a login?

Not as written: each check is one page load with no credentials, on purpose, so the monitor needs no secrets.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| The Monitor workflow is red | The monitor is broken: no browser, every site failed in one run, or `history.json` cannot be read | Open the run; the error line says which. A broken history file on `monitoring-data` has to be repaired or deleted by hand |
| No `monitoring-data` branch | The Monitor workflow has not run yet | Run it once from the Actions tab (it creates the branch) |
| No uptime section on the dashboard | The branch is missing, or the Dashboard has not rebuilt since | Wait for the next 3-hour rebuild or run the Dashboard workflow |
| The section says the monitor has not reported for 90 minutes | Monitor runs stopped (GitHub switches schedules off after 60 days without repository activity) | Run the Monitor workflow by hand and check [CI health](../../scripts/ci-health.mjs)'s issue |
| A site is down on the dashboard but opens fine in a browser | The site blocks the runner's address, or the title or element changed | Compare the error in the issue with `src/sites.ts` |

## Development

```bash
cd packages/synthetic-monitor
npm ci && npx playwright install chromium firefox
npm test                 # 32 unit checks, then 24 browser checks
npm run test:unit        # only the unit checks
npm run monitor -- --data data   # one real run against the four sites
npx tsc -p . --noEmit
```
