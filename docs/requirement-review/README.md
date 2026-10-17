# Requirement review: the ten Day 4 feature files

The ten plain-English feature files in [`packages/ai-test-generator/examples/input`](../../packages/ai-test-generator/examples/input) were written first and then handed to an AI, which wrote 43 tests from them. This is the review that should have come before that: every one of their 43 acceptance criteria read for what it fails to say, checked against the live Sauce Demo site, and followed through to a test or a question.

**In plain English:** a requirement is a promise about what the software does. This page lists where those promises were vague, missing or too weak to catch a mistake, what the real site does in each case, and which of those turned out to be bugs.

The full list is the [review log](review-log.md).

## Result

| | |
|---|---|
| Criteria reviewed | 43 |
| Clear as written | 16 |
| Needed work | 27 |
| Findings | 29 |

| Result | Findings | What it means |
|---|---:|---|
| defect | 8 | The site misbehaves. Each has a test marked `[known defect]`, expected to fail |
| test gap | 5 | The AI-written test passes but checks less than the criterion says |
| rule clarified | 13 | The criterion was vague or silent; the log records the rule, and a test pins it |
| open question | 3 | Only the product owner can answer; no test, because a test would invent the answer |

The new tests are in [`packages/ai-test-generator/tests/review`](../../packages/ai-test-generator/tests/review) (`npm run test:review`, 42 tests of which 8 are the expected-to-fail defects), separate from the 43 AI-written tests in `tests/regression`, which stay as they were generated. They run in the `ai-test-generator` CI job. Each test title starts with its finding ID.

## What was found

- **Money printed as a raw float** (RV-13). 6 of the 63 possible carts show an item total like `$119.94999999999999`, while the tax and total lines are rounded. The one example in the criteria (`$29.99`) happens to be exact, so a test written from it could never see this. The first probe of this review parsed the text as a number and missed it too; only comparing the exact text found it.
- **Green tests over a visible bug** (RV-28). All three generated tests for Reset App State pass, but the product list keeps showing "Remove" on items that are no longer in the cart.
- **One cart per browser** (RV-01). A second user who logs in on the same browser inherits the first user's cart.
- **Checkout without a checkout** (RV-05, RV-09). The confirmation page opens from its address, and an empty cart can be "ordered".
- **Weak criteria** (RV-14, RV-15, RV-21, RV-24). "Any sort" was tried once, "sorted" meant only the first row, "at least one product" passes with one of six, and "the same name and price" was checked for one product of six.

## How each criterion was reviewed

For every criterion, in this order:

1. **Could two people read it differently?** (RV-03: "hides" is hidden or absent; RV-14: "any".)
2. **Does it pass for a wrong implementation?** (RV-11: a hard-coded $2.40; RV-21: five products missing.)
3. **What does it leave out?** Inputs next to the ones it names (RV-06, RV-19, RV-20), a precondition it assumes (RV-25), another place the same thing shows (RV-04, RV-28), another user (RV-01, RV-17, RV-27).
4. **What does the live site do?** Observed in the browser first, then written as a test, so the log can be re-checked by running them.
5. **What is the outcome?** A rule written down and tested; a defect with a test that flips when the site is fixed; a gap in the generated test; or a question for the owner, with no test.

## What this does not cover

- **The site is third-party.** The defects are in a public demo shop and can't be fixed from here. They are documented and watched: when one is fixed, its `[known defect]` test passes unexpectedly and fails the CI job, which is the cue to remove the marker.
- **Behaviour can change under the tests.** The rules describe the site on 2026-10-17.
- **An expected failure can be the wrong failure.** Each `[known defect]` test was also run with the marker off (`REVIEW_SHOW_DEFECTS=1`) and fails with the message the log describes. This mattered twice: the first version of the marker made every defect test "fail" in 3 ms for a coding reason, and RV-09 passed by accident because it asserted before the page had changed.
- **The review stops at the written criteria and what the site shows.** There is no access to the shop's owners, so where a rule could go either way (RV-08, RV-16, RV-29) it is left as a question.
- **The 63-cart check (RV-11, RV-13) fills the cart through the site's own browser storage** and opens the overview address directly, so that it can look at every cart in about 6 seconds. The usual path through checkout is covered by the other tests.

## Keeping it honest

[`scripts/requirement-review.test.mjs`](../../scripts/requirement-review.test.mjs) runs with the rest of the root tests and fails if:

- a criterion in a feature file is missing from the log, reworded, or its verdict doesn't match its findings;
- a finding is missing a field, uses an unknown kind or result, or has a test that does not exist;
- a defect has no expected-to-fail test, or an expected-to-fail test belongs to a finding that is not a defect;
- an open question has a test (it shouldn't) or any other finding has none;
- a review test cites a finding that is not in the log;
- the totals on this page differ from the log.
