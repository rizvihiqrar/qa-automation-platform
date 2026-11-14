[← Back to overview](README.md)

# selector-drill: Technical Guide

- [How It Works](#how-it-works)
- [The Layout Changes](#the-layout-changes)
- [Adding a Selector](#adding-a-selector)
- [The Tests](#the-tests)
- [Deliberate Breaks](#deliberate-breaks)
- [Limits](#limits)

## How It Works

| File | What it does |
|---|---|
| `src/page.ts` | The order-desk page as one string: nav, search and filter chips, an orders table, a form, a dialog and a footer. 30 elements carry a `data-key`, the answer sheet. |
| `src/selectors.ts` | The hand-written CSS selector and XPath for each key. A selector written badly on purpose has a `weak` note saying why. |
| `src/variants.ts` | `applyVariant`, which runs inside the page and applies a layout change. |
| `src/drill.ts` | `measure(page)`: loads the page, makes the recorded paths, applies each change and tests every selector. |
| `src/report.ts` | Turns the results into the table, the list of what broke and the six rules. |
| `src/cli.ts` | `npm run drill`: launches Chromium and prints the report. |

The recorded path is made from the page before any change: for each keyed element, `body > tag:nth-child(n) > ...` up from the element. It is what recording a click would write, and it uses no names at all.

A selector survives when `page.locator(selector)` matches exactly one element and that element's `data-key` is the one asked for. Matching two elements, none, or the wrong one all count as broken.

## The Layout Changes

Each keeps every `data-key`, every attribute except `class`, and all the text.

| Change | What it does | What it models |
|---|---|---|
| wrap | A wrapper div around every child of `main`, `form`, `nav` and every table cell, one more around the whole body, and a banner at the top | A layout framework or a new grid |
| rename | Every class replaced with a new name | A restyle, or a build that hashes class names |
| reorder | The children of `nav`, the chips, the table body and the form put in reverse order | A sorted table, a nav that changed |
| redesign | All three, in that order | A real redesign |

## Adding a Selector

Add an entry to `DRILL` in `src/selectors.ts` with the key of an element in `src/page.ts`. Both selectors must find only that element on the unchanged page (check SD-02 fails if not). If you write one badly on purpose, add `weak: { css: 'why' }` or `weak: { xpath: 'why' }`. Check SD-08 reads the selector text: an unmarked selector with a class, a position or a ` > ` chain fails it, and a marked one that looks fine fails it too.

## The Tests

11 tests, `tests/drill.spec.ts`, in Chromium and Firefox (22 runs). One measurement of 5 pages and 90 selectors is shared by the tests of a browser.

| ID | What it checks |
|---|---|
| SD-01 | 30 elements, each with its own key, and a selector pair for each |
| SD-02 | Before any change every selector in all three styles finds its element and only it |
| SD-03 | Wrappers and a banner break every recorded path |
| SD-04 | Renamed classes break no recorded path but break the class-based CSS selector |
| SD-05 | Reordering breaks most recorded paths and the two position-based selectors |
| SD-06 | After the redesign the hand-written selectors keep 85% or more and the recorded paths 10% or less |
| SD-07 | Only the selectors marked weak ever break, and each marked one breaks in at least one change |
| SD-08 | The unmarked selectors have no class, position or child chain, and the marked ones do; none uses `data-key` |
| SD-09 | A selector that matches two elements, or the wrong one, counts as broken |
| SD-11 | The numbers in the README table are the measured ones |
| SD-10 | The report has the table, the list of what broke and the six rules |

In CI a test that passes only on a retry fails the job (`failOnFlakyTests` in the config).

## Deliberate Breaks

Each was put in, shown to fail, and taken out:

| Break | What failed |
|---|---|
| A strong selector (`place-order`) rewritten with class names | SD-07: an unmarked selector broke after the rename |
| The right-element check weakened to "found at least one" | SD-05 first: the position-based selectors no longer broke when the order changed |

The tests run in order in one worker, so the first failure hides the later ones; the second break would fail SD-09 as well.

## Limits

- One page and four changes. A real site has more kinds of change (text edits, a moved element between sections, a framework that rewrites attributes).
- The five weak selectors are chosen, not found. The drill measures how the weak style behaves; it does not measure how often people write it.
- It checks that a selector finds the right element, not that the element is clickable or visible.
