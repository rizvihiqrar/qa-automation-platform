[![browser-matrix: three browsers, eleven questions](docs/banner.svg)](docs/banner.svg)

# browser-matrix

A cross-browser matrix without a paid grid. It asks Chromium, Firefox and WebKit eleven questions about things browsers handle differently (which input types exist, what an empty required field says, how a number is written, where the first Tab press goes), records what each browser answers, and prints a table of where they differ. A test fails the day a browser starts answering differently.

**Overview:** a page that works in one browser can look or read differently in another, and the first sign is often a user's complaint. Playwright ships all three engines for free, so the question "do they differ?" can be asked on every build. The useful part is recording the answers: a difference you know about is documentation, and a difference that appears after a browser update is a finding.

**[Technical guide →](TECHNICAL.md)**

## Installation

```bash
cd packages/browser-matrix && npm ci && npx playwright install chromium firefox webkit
```

Node 24 or later.

## Quick Start

```bash
npm run matrix   # asks the eleven questions in all three browsers and prints the table
npm test         # 39 checks: each browser still answers the way it is recorded to
```

## The Result

What the three browsers answer on Linux, which is what CI runs (Playwright 1.65.1: Chromium 159, Firefox 159, WebKit 27.2):

| Question | Chromium | Firefox | WebKit | Same? |
|---|---|---|---|---|
| Input types offered (date, month, week, time, datetime-local, color) | all six | no month, no week | no month, no week | **differs** |
| Empty required field says | Please fill out this field. | Please fill out this field. | Fill out this field | **differs** |
| Number below the minimum says | Value must be greater than or equal to 1. | Please select a value that is no less than 1. | Value must be greater than or equal to 1 (no full stop) | **differs** |
| A date written with a space, not a T | parsed | parsed | parsed | same |
| en-CA date and time | same text | same text | same text | same |
| de-CH francs | CHF 1'234.50 | CHF 1'234.50 | CHF 1'234.50 | same |
| `:has()`, anchor positioning, `field-sizing` | supported | supported | supported | same |
| `showPicker()` | yes | yes | yes | same |
| First Tab press on a page with a link and a button | the link | the link | the link | same |

The differences left are in what the browser itself says and draws: its words, its form controls. The newer CSS that used to split the browsers is in all three now.

**Playwright's WebKit is not Safari, and it is not the same on every operating system.** On Windows the same version offers no date inputs at all, writes the Swiss franc with a different apostrophe, says "range underflow" for a number below the minimum, and sends the first Tab press to the button. Five of the eleven questions differ on Windows. So each recorded answer can be given per platform, and a platform with no recorded answer skips instead of guessing.

## At a Glance

- 11 questions, 3 browsers, 33 recorded answers (some per operating system) and 6 checks of the table itself
- A difference between browsers is not a failure. A browser changing its answer is
- Each answer is a short string read from the page, with nothing from the network or the machine
- Lookalike characters (a no-break space and a narrow no-break space) are written as code points, so a difference can be seen
- Runs on GitHub's free runners with Chromium, Firefox and WebKit installed by Playwright
- The table is also written to the job summary in CI

More on how a question is asked, how to add one and the deliberate breaks is in the [technical guide](TECHNICAL.md).
