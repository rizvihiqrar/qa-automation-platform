# a11y-aoda-audit

An accessibility audit of a small demo storefront, framed around Ontario's accessibility law (AODA). The site exists in two versions: **before**, with the defects audits most often find, and **after**, with each one fixed. The audit checks both and writes a findings report with the WCAG criterion, level and fix for every issue.

**In plain English:** accessibility means people who use screen readers, keyboards only, or who have low vision can use the site. In Ontario, many organizations are legally required to meet a specific standard for their public websites. This shows what an audit against that standard finds, and what fixing it looks like.

---

## AODA Context

Ontario's *Accessibility for Ontarians with Disabilities Act*, through the Integrated Accessibility Standards Regulation (O. Reg. 191/11), requires designated public sector organizations and businesses with 50 or more employees in Ontario to make public websites meet **WCAG 2.0 Level AA**, with exceptions for live captions (1.2.4) and pre-recorded audio descriptions (1.2.5).

This audit covers the automatically testable WCAG 2.0 A and AA rules, plus two checks automation often misses. Full conformance also needs manual and screen-reader testing. It's a testing aid, not legal advice.

---

## Findings: Before

**12 issue types, 26 instances across 4 pages.**

| Impact | Issue | WCAG | Level | Count |
|---|---|---|---|---:|
| critical | Buttons must have discernible text | 4.1.2 Name, Role, Value | A | 2 |
| critical | Drop zone has no keyboard path | 2.1.1 Keyboard | A | 1 |
| critical | Images must have alternative text | 1.1.1 Non-text Content | A | 2 |
| critical | Select element must have an accessible name | 4.1.2 Name, Role, Value | A | 1 |
| serious | Text below minimum colour contrast | 1.4.3 Contrast (Minimum) | AA | 2 |
| serious | Page has no `<title>` | 2.4.2 Page Titled | A | 1 |
| serious | Keyboard focus is not visible | 2.4.7 Focus Visible | AA | 10 |
| serious | `<html>` has no `lang` | 3.1.1 Language of Page | A | 1 |
| serious | Link has no text | 2.4.4 Link Purpose; 4.1.2 | A | 1 |
| serious | Status message is not announced | 4.1.3 Status Messages | AA | 1 |
| moderate | Field labelled only by a placeholder | 3.3.2 Labels or Instructions | A | 3 |
| moderate | Focus is lost after deleting | 2.4.3 Focus Order | A | 1 |

The full report, with the fix for each issue, is written to `reports/REPORT-before.md`.

## Findings: After

**No issues found** on any page.

---

## Five Things axe Alone Would Miss

**1. Placeholder-only fields.** The checkout form's three fields had no labels, only placeholders. axe raised nothing for them: it accepts a placeholder as a field's name. But a placeholder disappears as soon as someone types, which fails WCAG 3.3.2. A separate check finds all three, and a test asserts both facts.

**2. Removed focus outlines.** `outline: none` on focus is one of the most common keyboard problems. The audit tabs through each page with the keyboard and records every element whose focus has no outline or shadow (WCAG 2.4.7): 10 on the "before" site.

While building that check, the first version reported 8 instead of 10. Both "View product" links were the first link inside their own card, so they got the same identifier and were merged with the header link. Elements are now identified by their full path, and the test pins the counts per page (3, 3 and 4).

**3. A drag and drop upload with no keyboard path.** [upload.html](site/before/upload.html) is a drop zone made of a `div` that only listens for clicks. A person who uses the keyboard cannot reach it, and axe sees nothing wrong. The audit tabs through the page and looks for focus on a button inside the drop zone or on the file input (WCAG 2.1.1); a link or plain text in the zone does not count. The fixed page ([after](site/after/upload.html)) puts a real *Choose photos* button in the drop zone, and a test presses Enter on it and waits for the file chooser.

**4. A status line nobody announces.** After a file is added the page writes "1 photo(s) added". In the before page that line is a plain paragraph, so a screen reader says nothing (WCAG 4.1.3). The check adds a file through the file input and looks for a live region (`role="status"` or `aria-live`) around the status line, and that it was one *before* the text changed: a region created together with its text is not announced. (4.1.3 is a WCAG 2.1 criterion, beyond the 2.0 AA that AODA requires; the report says so.)

**5. Focus lost after delete.** The delete button is an icon with no name. axe finds that, but only once a file has been added, so the audit adds one before running axe. After the button is removed, focus falls back to the page body and the next Tab starts from the top (WCAG 2.4.3). The fixed page names the button (`Remove room.jpg`) and moves focus to *Choose photos*.

Each fix was taken out of the after page once to show its test fails: the live region, the focus move, the button (made a `div`), and the delete button's name.

**Not run:** a pass with a real screen reader (NVDA, VoiceOver). The checks above read the page structure; they do not say what a screen reader says. That stays a manual list: the drop zone is announced as a button, the status is read after adding a file, and the focus lands on *Choose photos* after a delete.

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
| Browser (Playwright) | 20 | Each "before" page reports **exactly** its planted defects; focus issue counts per page; axe misses placeholder-only fields and the extra check catches them; each "after" page is clean; the upload page: no keyboard path, status not announced, unnamed delete button (only after adding a file) and focus lost after delete in before, none in after, plus Tab and Enter opening the file chooser, and harder cases (a link or text in the drop zone is no keyboard path; a status role that arrives with the text is not announced). Chromium and Firefox both pass |
| Unit | 10 | WCAG mapping from axe tags, grouping and sorting, the report, the AODA note, the upload findings |

---

## Structure

```
├── site/
│   ├── before/        # index, product, checkout, upload, with defects
│   └── after/         # the same pages, fixed
├── src/
│   ├── server.js      # static server for both versions
│   ├── checks.js      # axe, keyboard focus, placeholder-only fields, upload checks
│   ├── wcag.js        # WCAG criteria, fixes, AODA note
│   ├── report.js      # findings and Markdown report
│   └── audit.js       # audits both versions
├── tests/             # Playwright tests
└── test/              # unit tests
```

The store and its products are fictional.
