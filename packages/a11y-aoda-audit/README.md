# a11y-aoda-audit

An accessibility audit of a small demo storefront, framed around Ontario's accessibility law (AODA). The site exists in two versions: **before**, with the defects audits most often find, and **after**, with each one fixed. The audit checks both and writes a findings report with the WCAG criterion, level and fix for every issue.

**In plain English:** accessibility means people who use screen readers, keyboards only, or who have low vision can use the site. In Ontario, many organizations are legally required to meet a specific standard for their public websites. This shows what an audit against that standard finds, and what fixing it looks like.

---

## AODA Context

Ontario's *Accessibility for Ontarians with Disabilities Act*, through the Integrated Accessibility Standards Regulation (O. Reg. 191/11), requires designated public sector organizations and businesses with 50 or more employees in Ontario to make public websites meet **WCAG 2.0 Level AA**, with exceptions for live captions (1.2.4) and pre-recorded audio descriptions (1.2.5).

This audit covers the automatically testable WCAG 2.0 A and AA rules, plus two checks automation often misses. Full conformance also needs manual and screen-reader testing. It's a testing aid, not legal advice.

---

## Findings: Before

**9 issue types, 22 instances across 3 pages.**

| Impact | Issue | WCAG | Level | Count |
|---|---|---|---|---:|
| critical | Buttons must have discernible text | 4.1.2 Name, Role, Value | A | 1 |
| critical | Images must have alternative text | 1.1.1 Non-text Content | A | 2 |
| critical | Select element must have an accessible name | 4.1.2 Name, Role, Value | A | 1 |
| serious | Text below minimum colour contrast | 1.4.3 Contrast (Minimum) | AA | 2 |
| serious | Page has no `<title>` | 2.4.2 Page Titled | A | 1 |
| serious | Keyboard focus is not visible | 2.4.7 Focus Visible | AA | 10 |
| serious | `<html>` has no `lang` | 3.1.1 Language of Page | A | 1 |
| serious | Link has no text | 2.4.4 Link Purpose; 4.1.2 | A | 1 |
| moderate | Field labelled only by a placeholder | 3.3.2 Labels or Instructions | A | 3 |

The full report, with the fix for each issue, is written to `reports/REPORT-before.md`.

## Findings: After

**No issues found** on any page.

---

## Two Things axe Alone Would Miss

**1. Placeholder-only fields.** The checkout form's three fields had no labels, only placeholders. axe raised nothing for them: it accepts a placeholder as a field's name. But a placeholder disappears as soon as someone types, which fails WCAG 3.3.2. A separate check finds all three, and a test asserts both facts.

**2. Removed focus outlines.** `outline: none` on focus is one of the most common keyboard problems. The audit tabs through each page with the keyboard and records every element whose focus has no outline or shadow (WCAG 2.4.7): 10 on the "before" site.

While building that check, the first version reported 8 instead of 10. Both "View product" links were the first link inside their own card, so they got the same identifier and were merged with the header link. Elements are now identified by their full path, and the test pins the counts per page (3, 3 and 4).

---

## Usage

```bash
npm install
npx playwright install chromium
npm run audit      # writes reports/REPORT-before.md and reports/REPORT-after.md
npm test           # unit tests, then the browser tests
```

`npm run audit` exits with code 1 if the "after" site has any issue, so it can guard against regressions.

---

## Tests

| Kind | Count | What they check |
|---|---:|---|
| Browser (Playwright) | 10 | Each "before" page reports **exactly** its planted defects; focus issue counts per page; axe misses placeholder-only fields and the extra check catches them; each "after" page is clean |
| Unit | 6 | WCAG mapping from axe tags, grouping and sorting, the report, the AODA note |

---

## Structure

```
├── site/
│   ├── before/        # index, product, checkout, with defects
│   └── after/         # the same pages, fixed
├── src/
│   ├── server.js      # static server for both versions
│   ├── checks.js      # axe, keyboard focus, placeholder-only fields
│   ├── wcag.js        # WCAG criteria, fixes, AODA note
│   ├── report.js      # findings and Markdown report
│   └── audit.js       # audits both versions
├── tests/             # Playwright tests
└── test/              # unit tests
```

The store and its products are fictional.
