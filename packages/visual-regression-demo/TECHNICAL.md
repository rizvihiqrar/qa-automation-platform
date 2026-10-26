[← Back to overview](README.md)

# visual-regression-demo: technical guide

## Contents

- [How it is built](#how-it-is-built)
- [Why the pictures stay the same](#why-the-pictures-stay-the-same)
- [Baselines](#baselines)
- [Planted visual bugs](#planted-visual-bugs)
- [Configuration](#configuration)
- [CI integration](#ci-integration)
- [Results](#results)
- [Deliberate breaks](#deliberate-breaks)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## How it is built

```text
packages/visual-regression-demo
  src/serve.ts               the banking UI on a frozen clock with four fixed accounts
  src/fetch-baselines.ts     brings the Linux baselines of a CI run into baselines/linux
  tests/helpers.ts           open a page and wait for it; trigger a refusal; the list of pages
  tests/pages.spec.ts        one baseline per page, light and dark, desktop and phone
  tests/planted-bugs.spec.ts six bugs the comparison must see, and the tolerance fact
  baselines/linux/<browser>/ the committed pictures (32)
  playwright.config.ts       tolerance, baseline path, two browsers
```

`src/serve.ts` is not a copy of the app. It imports `createApp` and `Ledger` from [banking-api](../banking-api/src), so the HTML, CSS, script and API are the real ones. It starts a ledger in memory with a clock that always says 2026-01-15 10:30, opens Ada, Grace, Alan and Mariam (ids 1 to 4), and makes four movements. The package has no runtime dependencies.

## Why the pictures stay the same

A screenshot test fails for the wrong reasons if the page changes by itself. The sources of change in this UI, and how each is closed:

| Source | How it is closed |
|---|---|
| The statement dates (the one value that changes every run) | The ledger's clock is frozen, so no mask is needed |
| Account ids | Accounts are opened in a fixed order on a fresh in-memory ledger |
| Animation and the text caret | `animations: 'disabled'` and `caret: 'hide'` |
| Fonts and anti-aliasing differ by operating system | Baselines are kept per platform, and only Linux's are committed (see below) |
| A page that is still drawing | `open()` waits for the heading, then for `document.fonts.ready` |
| Tests changing each other's data | Every test only reads the fixed data; the refusal tests send a request that is refused, so nothing is written |

## Baselines

The path is `baselines/<platform>/<browser>/<name>.png` (`snapshotPathTemplate` in the config). Fonts and anti-aliasing differ between Windows, macOS and Linux, so a picture made on one never matches on another. Only the Linux ones are committed, made on the runner that checks them.

| Task | How |
|---|---|
| Run on Windows or macOS | `npm test`. The first run writes baselines in `baselines/win32` or `baselines/darwin` (ignored by git) and fails; the next run compares against them |
| First baselines for a new page | Push the test. CI fails once on the missing baseline and keeps what it wrote. `npm run baselines -- <run id>` downloads it into `baselines/linux` |
| After a deliberate change to the UI | Run the **Visual baselines** workflow, then `npm run baselines -- <run id> update`. Look at every changed picture, then commit |

A baseline is the answer key. Review each one by eye before committing it, because a wrong baseline makes the suite agree with a bug.

## Planted visual bugs

Each test in [planted-bugs.spec.ts](tests/planted-bugs.spec.ts) loads a page that already has a baseline, injects one visual bug with a style tag, and expects `not.toHaveScreenshot`, which passes only when the picture differs. If the comparison ever goes blind, the test fails.

| Bug (the injected CSS) | Why a person misses it | Page |
|---|---|---|
| Button `#111418` became `#1c2128` | A few shades darker or lighter | Accounts, light |
| `h1` margin 8 px became 12 px | Everything below moves 4 px | Statement, light |
| `.btn { visibility: hidden }` | The space stays; the button is gone | Accounts, light |
| The balance clipped to three characters | A truncated amount reads as a smaller one | Statement, light |
| Dark-mode text the colour of the page | Fine in light mode, which is what the author uses | Accounts, dark |
| `white-space: normal` in the table cells | The statement wraps instead of scrolling on a phone | Statement, phone |

A seventh test states a fact about the tolerance: the same colour bug **passes** with Playwright's default `threshold: 0.2`. That is why the config sets 0.05. If someone loosens the setting back to the default, the first bug above goes unseen and its test fails; this test says why.

## Configuration

| Option | Value | What it does |
|---|---|---|
| `expect.toHaveScreenshot.threshold` | `0.05` | How different one pixel's colour may be (0 to 1). Playwright's default 0.2 misses the colour bug |
| `expect.toHaveScreenshot.maxDiffPixels` | `0` | No pixel may differ beyond the threshold |
| `animations`, `caret` | `disabled`, `hide` | Nothing moves or blinks |
| `snapshotPathTemplate` | `baselines/{platform}/{projectName}/{arg}` | One baseline set per system and browser |
| `viewport` | 1100 x 800 | Desktop; two tests use 390 x 844 (a phone) |
| `bypassCSP` | `true` | The page's own policy refuses an injected style tag, which the planted bugs use |
| `retries` | `0`, with `failOnFlakyTests` in CI | A screenshot that matches only on a retry fails the job |

## CI integration

The job `visual-regression-demo` in [ci.yml](../../.github/workflows/ci.yml) installs Chromium and Firefox through the shared install script and runs `npm test`. A failed run uploads the Linux baselines as the `visual-baselines` artifact and the expected, actual and diff pictures with the report.

```yaml
- { package: visual-regression-demo, browsers: true, browserList: chromium firefox, command: npm test }
```

The [Visual baselines](../../.github/workflows/visual-baselines.yml) workflow is manual. It remakes every baseline on a Linux runner and uploads them as `visual-baselines-updated`.

## Results

| Result | Number | Source |
|---|---|---|
| Visual bugs planted and caught | 6 of 6, in both browsers | [planted-bugs.spec.ts](tests/planted-bugs.spec.ts) |
| Checks | 46: 16 page comparisons and 7 planted-bug tests, in each browser | CI job |

## Deliberate breaks

| Change put in | What the suite did |
|---|---|
| Card padding 20 to 22 px and button colour `#111418` to `#1c2128` in the app's own `app.css` | 14 of 16 page comparisons failed in Chromium (the two not-found pages have no card or button); put back, 16 of 16 pass |
| The six planted bugs, one at a time | Each is seen (the planted-bug tests pass) |

The diff of the first row is on the [overview](README.md#what-a-failure-looks-like).

## FAQ

**Why not mask the dates?** A mask hides a region, and a bug in that region goes unseen. Freezing the clock keeps the whole page under test.

**Why Linux baselines only?** The runner is Linux, so those are the pictures that decide whether CI passes. A Windows picture would differ in every glyph.

**Why a new package instead of Cypress screenshots in banking-api?** The banking UI already has [Cypress tests](../banking-api/TECHNICAL.md#the-banking-ui-tested-with-cypress). This one is about images, in Playwright, in two browsers, and keeps its baselines and CI job apart.

**Will a runner image update break every baseline?** It can. A newer font package changes text rendering. The failure is a diff on every page, so the fix is to remake the baselines with the manual workflow and review them.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Every test fails the first time on Windows | No baselines yet for this system | Run again; they were written on the first run |
| Every page differs in CI at once | The runner's fonts changed | Remake with the Visual baselines workflow and review the pictures |
| A new test fails with "snapshot doesn't exist" in CI | Its Linux baseline is not committed | `npm run baselines -- <run id>`, review, commit |
| `npm run baselines` says it cannot find the artifact | The run did not fail, or the artifact expired (7 days) | Remake with the manual workflow (`update`) |
| A planted-bug test fails | The comparison no longer sees that bug | Look at the threshold and the baseline before anything else |

## Development

```bash
npm ci
npx playwright install chromium firefox
npm test                      # both browsers
npx playwright test --project=chromium tests/pages.spec.ts
npx playwright show-report    # expected, actual and diff for a failure
npx tsc --noEmit -p .         # type-check
```
