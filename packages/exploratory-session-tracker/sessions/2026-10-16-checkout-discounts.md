# Charter: Explore checkout discount codes with invalid, expired and oddly formatted codes to find pricing errors

**Tester:** QA
**Area:** Checkout
**Timebox:** 60
**Started:** 2026-10-16T09:00

## Notes
[09:03] NOTE: Valid code SAVE10 takes 10% off as expected.
[09:11] BUG: " SAVE10" with a leading space is accepted, but no discount is applied and no message is shown.
[09:19] QUESTION: Should codes be case-insensitive? "save10" is rejected while "Save10" works.
[09:27] BUG: Applying two codes in a row keeps only the second discount, but both appear in the summary.
[09:36] IDEA: Add a regression test for an expired code (SUMMER25 ended last month).
[09:44] RISK: Discounts are calculated in the browser; a tampered request might set any total.
[09:58] NOTE: Session ended; covered valid, expired, spacing, case and stacking.
