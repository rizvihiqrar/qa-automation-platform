[← Back to overview](README.md)

# browser-matrix: Technical Guide

- [How It Works](#how-it-works)
- [Recording an Answer](#recording-an-answer)
- [Adding a Question](#adding-a-question)
- [The Tests](#the-tests)
- [Deliberate Breaks](#deliberate-breaks)
- [Limits](#limits)

## How It Works

| File | What it does |
|---|---|
| `src/probes.ts` | The questions. A probe has an id, the question in words, and `ask(page)`, which returns a short string. `PAGE_HTML` is the one page they all run on (a link, a button, a form, a dialog). |
| `src/matrix.ts` | `askBrowser(name)` launches one browser and asks every probe on a fresh page. `combine`, `differing` and `toTable` put the answers side by side and mark the rows that differ. |
| `src/expected.ts` | The recorded answers: for each probe, what each browser says, written once or once per platform. |
| `src/cli.ts` | `npm run matrix`: asks all three browsers, prints the table, and appends it to the job summary when `GITHUB_STEP_SUMMARY` is set. |
| `tests/matrix.spec.ts` | One test per probe and browser, plus five checks of the table that run once. |

The Playwright config has three projects (Chromium, Firefox, WebKit), `locale: 'en-CA'`, one retry in CI and `failOnFlakyTests`, so a test that passes only on the retry fails the job. The CI job installs all three browsers (`browserList: chromium firefox webkit` in `ci.yml`), and the burn-in script runs the specs repeatedly in all three.

## Recording an Answer

The recorded answers are in `src/expected.ts`:

```ts
'number-message': {
  chromium: 'Value must be greater than or equal to 1.',
  firefox: 'Please select a value that is no less than 1.',
  webkit: { win32: 'range underflow', linux: 'Value must be greater than or equal to 1' },
},
```

A plain string is the answer on every platform. An object gives it per platform (`linux`, `win32`, `darwin`). A test on a platform with no answer is skipped with a reason, so a Mac run says what is missing instead of failing or guessing.

The first run on a new platform is a recording run: set the answer to anything, run the tests, and read `Received` in the failure. That is how the Linux answers were found: the Windows answers were recorded on the author's PC, the Linux ones were marked `UNKNOWN`, and the first CI run printed what Linux WebKit answers. Do not copy answers from one platform to another without running it there: it was the Windows answers that turned out to be the odd ones.

Lookalike characters are written as code points by `visible()` in `probes.ts` (`CHF 1'234.50`), because a no-break space and a plain space look the same in a table and a diff.

## Adding a Question

1. Add a probe to `PROBES` in `src/probes.ts`. Keep the answer short, and read only what the browser itself decides: no network, no clock, no machine setting.
2. Run `npm run matrix`. Read the table.
3. Add the answers to `EXPECTED`. The test `every probe has an answer recorded for all three browsers, and nothing else is recorded` fails until you do, and fails if an answer is recorded for a probe that does not exist.
4. Run `npm test` in the three browsers, several times.
5. Run it on Linux (open a pull request): add per-platform answers where CI disagrees.

## The Tests

| Group | Tests | What they check |
|---|---:|---|
| One per probe and browser | 33 | The browser answers the way it is recorded to on this platform |
| The table | 5 | Every probe has an answer for all three browsers and nothing else; ids are unique; `differing`; `toTable`; `expectedAnswer` reads a per-platform answer and returns nothing for an unknown platform |

The five run in the first project only, so Firefox and WebKit report them as skipped. The count is 38 tests that ran.

## Deliberate Breaks

| Break (put back after) | Result |
|---|---|
| A wrong answer recorded for Firefox (`:has()` as `false`) | The Firefox `css-has` test failed: `Expected: "false"`, `Received: "true"`; the other 37 passed |
| The Linux WebKit answers marked `UNKNOWN` (the first CI push) | 4 WebKit tests failed on Linux and printed the real answers |

## Limits

- Playwright's builds are not the browsers people use. Chromium is close to Chrome and Edge, Firefox is Firefox, but WebKit is a port: it is not Safari, and the table above shows how far it moves between operating systems. A real Safari needs a Mac or a cloud grid.
- Eleven questions are a sample, chosen because they differ or used to differ. They say nothing about a page's layout or scripts: for that, run the page's own tests in all three projects.
- An answer depends on the browser version. The versions are pinned by `package-lock.json`, so a change shows up in the pull request that updates Playwright, which is the moment to re-record.
- Mobile browsers and touch input are not covered.
