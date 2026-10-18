# Validating AI-written code: discount codes

A small feature for qa-practice-api, discount codes, written by an AI from a spec, and tested the way any code from an unknown author should be: review the requirement before the code exists, then review the code, then test it with techniques chosen to find what a happy-path check misses. The result to publish at the end is a list of what the AI got wrong and which technique caught each mistake.

**In plain English:** an AI can write working-looking code in seconds. This shows how to check it: first make sure everyone agrees on what it should do, then read it, then test it hard, and keep score of what each step found.

| Day | Step | Status |
|---:|---|---|
| 37 | Review the request, write the reviewed spec, have the AI write the feature | ✅ this page |
| 38 | Code review; boundary-value and decision-table tests against the spec | ✅ [code review](code-review.md) |
| 39 | Property-based tests (fast-check) and mutation testing; what the AI got wrong and what caught it | ✅ [properties and mutation](properties-and-mutation.md), [scoreboard](scoreboard.md) |

## Day 37: the requirement, then the code

1. **The [request](request.md)**, kept as it arrived: nine lines, the kind of text a product owner writes.
2. **The [review log](review-log.md)**: every line read for what it leaves out. All nine needed work; 24 findings, each with a question and a decision.
3. **The [reviewed spec](spec.md)**: 25 numbered rules (DC-R01 to DC-R25) and six worked examples. Later tests name these rule IDs.
4. **The [AI run](ai-run/README.md)**: the exact [prompt](ai-run/prompt.md), and the code committed unedited before anything was run.

### Review result

| | |
|---|---|
| Request lines | 9 |
| Needed work | 9 |
| Findings | 24 |
| Rules in the reviewed spec | 25 |

| Kind | Findings | What it means |
|---|---:|---|
| missing | 14 | The request says nothing about a case the code will meet |
| ambiguous | 8 | Two reasonable readers would build different things |
| risk | 2 | Read literally, the request builds something unsafe |

22 findings became rules. 2 (DC-23, DC-24) are open questions, listed as out of scope in the spec rather than answered by guessing.

### What the review changed

- **Money.** "Percentage off" with no rounding rule: 10% of $10.05 is $1.005, and the obvious JavaScript, `Math.round(1.005 * 100) / 100`, gives $1.00, because 1.005 is stored as 1.00499…. The spec now says half a cent rounds up and amounts are worked out in whole cents (DC-08). The same float noise showed on a real shop in the [Day 35 review](../requirement-review/README.md) (RV-13).
- **Probing.** Different messages for "no such code" and "code turned off" would let anyone discover codes that once existed (DC-02), the same kind of leak as sign-up revealing registered emails on Day 36.
- **What `total` means.** Every existing client reads `total` as the amount to pay. Making it the pre-discount figure would silently overcharge in every client; the spec keeps `total` and adds `subtotal` and `discount` (DC-16).
- **Uses.** "A usage limit" said nothing about per customer, what counts as a use, or a cancelled order (DC-11, DC-12), or two customers taking the last use at once (DC-13).
- **The API document.** The drift checker and the ZAP scan both read the OpenAPI document, so a feature missing from it is neither contract-checked nor scanned (DC-17).

### The AI's code passed every gate it was given

Typecheck, the 165 existing tests, the drift check and the root tests were all green on the AI's first commit, and none of them ran a line of the discount code (details in the [AI run](ai-run/README.md)). That is the starting point for Day 38: green CI on AI-written code says the code compiles and broke nothing already tested, not that it does what the spec says.

## Day 38: the code review, then designed tests

The [code review](code-review.md) read `d775d20` rule by rule, then 126 designed cases, each naming the rule it checks, were run against it before anything was fixed. 12 failed. They come down to four defects and one gap in the spec:

- **Impossible dates.** `2027-02-29`, `2028-02-30` and `2027-04-31` were accepted as expiry dates, because `Date.parse` rolls them over to the next month instead of refusing them.
- **A tolerance in a two-decimal check.** To accept 0.29 (0.29 × 100 is 28.999999999999996 in floating point), the AI allowed a tiny difference, which also let in `10.000000000001` and `0.1 + 0.2`. A minimum of `49.999999999999` was stored and shown as such, while orders were checked against 50.00 and the refusal quoted 50.00.
- **The wrong error first.** A bad `discount_code` was checked before the items, so an unknown product's `404` became a `400` about the code, against the spec's order.
- **A list as a PATCH body** passed the unknown-field check (a list has no keys) and answered `200`.
- **The spec gap:** product prices could have more than two decimals. The AI's cents arithmetic was right for whole-cent prices but changed existing totals (three at 0.333: 1.00 before, 0.99 after), and none of the 165 earlier tests noticed.

All five are fixed, and each fix was checked by putting the mistake back: each time, exactly the cases the review lists failed. The AI got the hard parts right: money in whole cents with half-up rounding, the order of the five refusals, the same message for unknown and disabled codes, and uses counted from orders, so ten customers racing for the last use get exactly one. The review also records three risks it didn't fix, including that the last-use guarantee depends on checking and saving in one synchronous step, which a database would break (Day 49).

The drift scenario now calls all four `/discounts` operations: the AI's API document matched all 39 responses. Its request schemas say less than the rules do, and no tool checks request schemas, so each field now states its rule.

## Day 39: properties, mutation testing, and the scoreboard

[Property-based tests](properties-and-mutation.md) stated rules for any input and let fast-check try thousands of values. On its first generated case, one found a mistake nothing else had: with no limit on an order, a subtotal of 141,669,743,892,942.18 came back as …942.2, because cents past 2^53 don't fit exactly in a JavaScript number (PM-01; orders are now limited to 999,999,999.99). Putting CR-02 back showed another half of it the review had missed: the AI's tolerance also refused about 9% of valid amounts from 131,072.02 up (PM-02). A model-based test runs random sequences of orders, cancellations and admin changes and checks `uses` against a model after every step.

[Mutation testing](properties-and-mutation.md#mutation-testing) with Stryker broke the AI's code 412 small ways to see which breaks the tests notice: the designed cases noticed 85.0%, the properties 77.9%, both together 93.9%, and every one of the 25 left over was read and explained (21 can't change what the API does). Along the way it showed that the designed cases checked the status of 16 refusals but not their message, and that no test sent a value wrapped in a list or used a code more than 10 times; four properties now do.

The [scoreboard](scoreboard.md) puts each of the seven mistakes back and runs every test: the 165 tests that existed before caught none, the code review found five, and catching all seven with tests takes four techniques together (boundary values, decision tables, equivalence classes and properties).

## Keeping it honest

[`scripts/ai-written-code.test.mjs`](../../scripts/ai-written-code.test.mjs) runs with the root tests and fails if:

- a line of the request is missing from the review log or quoted differently, or a line's verdict doesn't match its findings;
- a finding is missing a field, has an unknown kind, sits under a line it doesn't name, or points to a rule the spec doesn't have;
- the open questions don't match the spec's out-of-scope list;
- the spec's rule IDs have gaps or repeats;
- the spec in the prompt differs from the spec in this folder by a single character;
- the totals on this page don't match the log;
- a designed discount case has a duplicate or skipped ID, or names a rule the spec doesn't have, or a rule (other than DC-R25, which the drift scenario covers) has no case;
- the drift scenario stops calling one of the `/discounts` operations;
- a code review finding is missing a field, isn't tied to the AI's commit, or lists a case that doesn't exist or checks a different rule; a defect has no case;
- the code review's coverage table, technique counts or totals don't match the case files and the findings;
- a property test has a duplicate or skipped ID, or names a rule the spec doesn't have;
- a PM finding is missing a field or lists a property that doesn't exist;
- the scoreboard doesn't put back every defect and spec gap, a put-back makes no test fail, or a finding's listed test passes with its mistake put back;
- a row of the scoreboard table differs from the scoreboard run;
- the lines of `orders.ts` that Stryker mutates are no longer the ones the AI wrote.
