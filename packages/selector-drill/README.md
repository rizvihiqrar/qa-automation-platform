[![selector-drill: thirty elements, three ways to find each, four layout changes](docs/banner.svg)](docs/banner.svg)

# selector-drill

A drill for writing selectors that survive a redesign. It takes an order-desk page with 30 elements, finds each one three ways (the path a test recorder writes, a hand-written CSS selector and a hand-written XPath), then changes the page layout four ways and counts which selectors still find the right element. A selector counts only if it finds exactly one element and it is the right one.

**Overview:** a test that breaks every time someone adds a wrapper or renames a class is expensive to keep. The drill shows how much of that comes from how the selector was written, with numbers instead of opinions, and ends in six rules.

**[Technical guide →](TECHNICAL.md)**

## Installation

```bash
cd packages/selector-drill && npm ci && npx playwright install chromium firefox
```

Node 24 or later.

## Quick Start

```bash
npm run drill   # prints the report below
npm test        # 11 checks, in Chromium and Firefox
```

## The Result

Share of the 30 selectors that still find the right element:

| Layout change | Recorded path | CSS | XPath |
|---|---:|---:|---:|
| Before any change | 100% | 100% | 100% |
| Wrappers and a banner added | 0% | 97% | 97% |
| Every class renamed | 100% | 93% | 100% |
| Lists, rows and fields reordered | 37% | 97% | 93% |
| All three together | 0% | 90% | 93% |

The recorded path is built from tag names and positions only, so it holds up against renamed classes and nothing else. Of the 60 hand-written selectors, five are weak on purpose (a class name, a row position, a chain of direct children through a class, two XPath positions), and the tests expect exactly those five to break, so the other 55 never do.

## At a Glance

- 30 elements, 90 selectors, 5 versions of the page (before, wrap, rename, reorder, all three)
- A selector that finds two elements, or the wrong one, counts as broken
- The answer sheet (`data-key` on each element) is never used by a selector, and a test checks it
- Six rules at the end of every report, each one backed by a selector that broke
- Runs in Chromium and Firefox, with no server and no network

## The Six Rules

1. Use an attribute that says what the element is: a label, a name, a type, an href or a test id.
2. Never use class names.
3. Never count position.
4. Never chain direct children to reach an element.
5. Never copy the path a recorder wrote.
6. Check that it matches exactly one element.

More on how the layout changes work, how to add your own selectors and the deliberate breaks is in the [technical guide](TECHNICAL.md).
