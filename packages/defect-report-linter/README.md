# defect-report-linter

Checks bug reports before they reach a developer: missing steps, no expected or actual result, an invalid severity, vague wording, missing evidence. Each report gets a score and a status: **Ready**, **Needs polish**, or **Not ready**.

**In plain English:** a weak bug report costs a developer time going back and forth asking "how do I reproduce this?" This tool catches those gaps when the report is written.

Reports can be Markdown files or JSON (including Jira-style field names such as `summary`, `priority`, `stepsToReproduce`).

---

## Example

```
$ npm run lint

100  Ready        batch.json#1  Sort by price (low to high) lists the Onesie second instead of first
 80  Needs polish batch.json#2  Typo on the checkout complete page
       warning evidence-missing: Critical defect has no screenshot, log or attachment
       warning severity-mismatch: Marked Critical but reads like a cosmetic issue; check the severity
 45  Not ready    batch.json#3  Cart badge
       warning title-vague: Title "Cart badge" doesn't say what fails where; aim for "<what> <does what wrong> <where>"
       warning environment-missing: No environment (browser, OS, build or server)
       warning steps-too-few: Only one step; someone else probably can't reproduce it from that
       error   expected-equals-actual: Expected and actual results are the same
100  Ready        good-report.md  Discount code SAVE10 isn't applied to the checkout total
 10  Not ready    weak-report.md  Checkout broken
       warning title-vague: Title "Checkout broken" doesn't say what fails where; aim for "<what> <does what wrong> <where>"
       error   severity-invalid: Severity "Urgent" isn't one of critical, high, medium, low
       warning environment-missing: No environment (browser, OS, build or server)
       warning steps-too-few: Only one step; someone else probably can't reproduce it from that
       error   expected-missing: No expected result
       warning actual-vague: Actual result "It doesn't work." is vague; describe what you saw (message, value, screen)

5 report(s): 2 ready, 1 need polish, 2 not ready
```

---

## Rules

| Rule | Level | Catches |
|---|---|---|
| `title-missing` | error | No title |
| `title-vague` | warning | Under 4 words, or starts with "bug", "issue", "broken", "doesn't work" |
| `severity-missing` / `severity-invalid` | error | No severity, or not Critical / High / Medium / Low |
| `environment-missing` | warning | No browser, OS, build or server |
| `steps-missing` | error | No steps to reproduce |
| `steps-too-few` | warning | A single step |
| `expected-missing` / `actual-missing` | error | No expected or actual result |
| `expected-equals-actual` | error | Expected and actual say the same thing |
| `actual-vague` | warning | Short actual result like "it doesn't work" or "broken" |
| `evidence-missing` | warning | Critical or High with no screenshot, log or attachment |
| `severity-mismatch` | warning | Critical or High, but the wording is cosmetic (typo, alignment, font) |

**Score:** 100, minus 25 per error and 10 per warning. **Ready** means no errors and a score of 90 or more.

---

## Report Format

Markdown: a `#` title, `**Field:** value` lines, and `##` sections.

```markdown
# Discount code SAVE10 isn't applied to the checkout total

**Severity:** High
**Environment:** Chrome 129 on Windows 11, staging build 4.2.1

## Steps to Reproduce
1. Log in as standard_user
2. Add the Backpack to the cart
3. Enter SAVE10 at checkout and click Apply

## Expected Result
The total drops by 10% to $26.99.

## Actual Result
The total stays at $29.99 and no error is shown.

## Evidence
- checkout-save10.png
```

JSON: one object or an array, with `title`, `severity`, `environment`, `steps` (array or text), `expected`, `actual`, `evidence`.

---

## Usage

```bash
npm run lint                               # the examples
node src/cli.js path/to/reports/           # a folder of .md and .json files
node src/cli.js report.md --min-score 90   # fail anything below 90
node src/cli.js reports/ --format md       # Markdown table for a PR comment
```

Exit code 1 when any report has an error (or scores below `--min-score`), so it can run as a check on a reports folder.

---

## Tests

```bash
npm test   # 20 tests
```

Each rule is tested in both directions (it fires when it should and stays quiet when it shouldn't), and the example files have exact expected scores. To confirm the tests catch a broken rule, `expected-equals-actual` was switched off on purpose: 3 tests failed.
