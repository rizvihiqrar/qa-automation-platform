# Validating AI-written code: discount codes

A small feature for qa-practice-api, discount codes, written by an AI from a spec, and tested the way any code from an unknown author should be: review the requirement before the code exists, then review the code, then test it with techniques chosen to find what a happy-path check misses. The result to publish at the end is a list of what the AI got wrong and which technique caught each mistake.

**In plain English:** an AI can write working-looking code in seconds. This shows how to check it: first make sure everyone agrees on what it should do, then read it, then test it hard, and keep score of what each step found.

| Day | Step | Status |
|---:|---|---|
| 37 | Review the request, write the reviewed spec, have the AI write the feature | ✅ this page |
| 38 | Code review; boundary-value and decision-table tests against the spec | ⬜ |
| 39 | Property-based tests (fast-check) and mutation testing; what the AI got wrong and what caught it | ⬜ |

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

## Keeping it honest

[`scripts/ai-written-code.test.mjs`](../../scripts/ai-written-code.test.mjs) runs with the root tests and fails if:

- a line of the request is missing from the review log or quoted differently, or a line's verdict doesn't match its findings;
- a finding is missing a field, has an unknown kind, sits under a line it doesn't name, or points to a rule the spec doesn't have;
- the open questions don't match the spec's out-of-scope list;
- the spec's rule IDs have gaps or repeats;
- the spec in the prompt differs from the spec in this folder by a single character;
- the totals on this page don't match the log.
