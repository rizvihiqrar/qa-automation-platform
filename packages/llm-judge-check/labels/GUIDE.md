# Labelling guide

How the human labels in [`key.json`](key.json) were decided. The reviewer went through all 67 cases in [`review-sheet.md`](review-sheet.md) and changed 7 of the drafted labels. These rules come from that review; rubric v2 ([`judge/prompt-v2.md`](../judge/prompt-v2.md)) gives them to the judge.

## The question

**If the app broke this criterion in a realistic way, would a test fail?**

| Verdict | Means | Example |
|---|---|---|
| covered | A realistic violation of the criterion fails a test | J21: the exact first-name error text |
| partial | Some realistic violations fail a test, others don't | J64: a wrong badge count fails, a missing badge passes |
| missing | No realistic violation fails a test | J47: no assertion at all |

"Missing" is kept for tests that catch nothing. A test that catches a wrong value but not a missing element is partial, even when the missed case is the more likely bug (J64): the reason says so.

## Rules

1. **Judge the criterion as written.** A weak criterion fully checked is covered; the weakness is logged against the criterion, not the test. *J53:* "at least one product" is checked by the first product being visible, so covered; showing 1 of 6 products would be a real bug, but no criterion asks for 6. The same goes for the sort criteria that name only the first row (J44, J41, J20, J55).
2. **One example is enough, unless the other cases could realistically behave differently.** *J29*: "increments by 1", tested only from an empty cart, can't tell "+1" from "set to 1", so its own test is partial; another test settles it (rule 5). *J08* (partial): a rule for every product, tried on one, in an app known to mix products up. *J05* (covered): 2 → 1 rules out the realistic bugs. *J54* (covered): the criterion names the result "a badge of 1", which only applies from an empty cart.
3. **Check what the criterion names, not a stand-in.** The address is enough when the criterion names a kind of page (J12, J31, J37, J42, J02, J50: covered). It isn't when the criterion is about specific content (*J07*, partial: the right address can show the wrong product, and Day 35 saw it happen). Names alone don't make a cart "match" the items added (*J57*, *J40*, partial).
4. **Label what was verified at runtime, not how the code looks.** *J62* (covered): an unawaited `expect` looks unenforced, but Playwright 1.64 fails the test when it's still pending at the end (a wrong value always fails; a right value can also fail if the check has not settled, so it is flaky, not weak). *J11* (partial): the test looks complete, but the details page hadn't rendered before the cart click in 5 of 20 runs. *J65* (partial): the draft said missing, but `not.toHaveText` fails when the element is absent. The checks are in [`evidence/label-evidence.spec.ts`](../evidence/label-evidence.spec.ts).
5. **Any test in the suite can cover a criterion.** *J13* (covered): its own test can't fail, but another test in the same file checks the login page after logout. *J29* and *J27* (covered): the test that adds two products and expects a badge of 2 fails for "set to 1". J29 was first relabelled partial in review; the rubric-v2 judges pointed out the two-product test, and the label went back to covered. A judge's disagreement can find a label error.

## Ambiguous cases

Where a careful reader could answer differently, `key.json` has a `borderline` note: J07, J08, J11, J13, J27, J29, J40, J53, J57, J62. When a judge disagrees on one of these, it says less than a disagreement on a clear-cut case.

## Criterion gaps (not coverage gaps)

Logged here instead of lowering a test's label:

- Login C5 asks for "at least one product"; the products page should show all 6 (Day 35, RV-21).
- The sort criteria name only the first row; a sort that gets the first row right and the rest wrong passes them (Day 35, RV-15).
