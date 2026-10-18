# Property-based tests and mutation testing of the AI's discount codes

Day 39 of the [case study](README.md). Day 38's [code review](code-review.md) and 126 designed cases checked the AI's code (`d775d20`) at the values a tester picks: boundaries, table rows, one value per class. Two questions were left. What happens at the values nobody picks? And would the tests notice if the code were wrong in a way nobody thought of? Property-based tests answer the first, mutation testing the second.

**In plain English:** instead of choosing test values by hand, a property-based test states a rule ("the total is always the subtotal minus the discount, to the cent") and lets a tool try hundreds of random values against it. Mutation testing then breaks the code on purpose, hundreds of small ways, and counts how many of those breaks the tests notice.

<!-- results -->

## Property-based tests

13 properties in [`packages/qa-practice-api/tests/properties`](../../packages/qa-practice-api/tests/properties), written with [fast-check](https://fast-check.dev) and run by `node --test` (`npm run test:properties`, about 5 seconds, part of the qa-practice-api CI job). Each test title starts with its ID and the rules it checks, like the designed cases.

They run against the API in the test's own process (the Playwright suites start a separate server), so one property can make hundreds of requests a second, and the mutation tests below can reach the route code through them. Expected amounts come from a reference that shares nothing with the code: prices are generated as text ("19.99"), read as BigInt cents, and added and rounded in whole numbers.

| ID | Rules | What must hold, for any generated input |
|---|---|---|
| DC-PR-01 | DC-R07 | Every amount from 0.00 to 9,999.99 (all million of them, not a sample) is whole cents and reads as its own cents |
| DC-PR-02 | DC-R07 | The same for any amount up to 999,999,999.99 |
| DC-PR-03 | DC-R18 | Cents turn into an amount and back unchanged |
| DC-PR-04 | DC-R04 | An amount with a third decimal is refused, unless JSON has already read it as a whole-cent number (see below) |
| DC-PR-05 | DC-R04 | Below 1,000,000.00, any third decimal is refused |
| DC-PR-06 | DC-R04 | NaN and infinity are never whole cents |
| DC-PR-07 | DC-R16, DC-R17, DC-R18 | Any cart (1 to 5 lines) with any code and minimum: subtotal, discount and total match the exact reference, or the order is refused because the subtotal is under the minimum |
| DC-PR-08 | DC-R17 | Percent discounts that land exactly on half a cent round up; their neighbours round to nearest |
| DC-PR-09 | DC-R18 | Orders up to 999,999,999.99 are exact; above, refused (finding PM-01) |
| DC-PR-10 | DC-R01, DC-R13 | A code is found whatever its case and the spaces around it |
| DC-PR-11 | DC-R05 | `expires_at` is accepted exactly when it is a real date-time, checked against a calendar written from the leap-year rule (years up to 2500, so 2100, 2200 and 2300 are not leap years and 2400 is) |
| DC-PR-12 | DC-R11, DC-R15, DC-R21, DC-R22, DC-R23 | A model of uses: random sequences of up to 20 orders, cancellations, `max_uses` changes and switching the code off and on, from three customers. After every step `uses` matches the model, never exceeds `max_uses`, and each refusal is the one DC-R15 says comes first |
| DC-PR-13 | DC-R04, DC-R07 | Any whole-cent fixed value and minimum up to 999,999,999.99 is accepted and stored as sent (finding PM-02) |

### What the properties got wrong first

A property is code too, and two were wrong before the API was:

- **DC-PR-04's first version** said any text with a third decimal must be refused. fast-check's first counterexample was `537704868.1699999`, which JSON reads as exactly the same number as `537704868.17`: a double holds about 16 significant digits, and the extra digits are gone before any code sees the request. No server reading JSON numbers can refuse it. The property now says exactly that, and DC-PR-05 keeps the strict version for amounts under a million, where it does hold.
- **DC-PR-07's carts** could exceed the order limit added for PM-01, so the property was really testing the limit, not the discount. Its prices now stay under it; DC-PR-09 covers the limit.

## Findings

### PM-01 No limit on an order, so a large subtotal lost cents

- **Rule:** DC-R18
- **Kind:** spec gap
- **Where:** `src/routes/orders.ts` line 78, `subtotalCents += toCents(product.price) * quantity` (`d775d20`)
- **Found by:** property-based test, on its first generated case
- **What happened:** nothing limits a price, a quantity or an order. fast-check's first case for DC-PR-09 was one product at 1,037,432,767.71 × 136,558: the subtotal is 141,669,743,892,942.18, and the API answered 141,669,743,892,942.2. In cents that is past 2^53, where a JavaScript number can no longer hold every whole number, so the cents arithmetic DC-R18 asks for silently stops being exact. The code review, the 126 designed cases and the 165 earlier tests never used an order that large; the spec has no boundary there to pick.
- **Tests:** DC-PR-09
- **Fix:** an order whose subtotal would be above 999,999,999.99 is refused with 400 (`MAX_ORDER_CENTS` in `src/money.ts`), checked after the items. DC-PR-09 checks both sides and the exact edges (999,999,999.99 accepted, 1,000,000,000.00 refused) on every run.

### PM-02 The two-decimal tolerance also refused valid amounts

- **Rule:** DC-R04, DC-R07
- **Kind:** defect
- **Where:** `src/routes/discounts.ts` line 19, `hasAtMostTwoDecimals` (`d775d20`)
- **Found by:** property-based test, when the scoreboard put CR-02 back
- **What happened:** CR-02 found that the AI's check (`n * 100` within 0.000000001 of a whole number) was too loose: it let in `10.000000000001`. It was also too strict, which the review missed. The error in `n * 100` grows with `n`, and from 131,072.02 (2^17 dollars) up it passes 0.000000001 for about 9% of perfectly valid amounts: a fixed discount or a minimum of 131,072.02 was refused with "at most two decimals". DC-PR-07 failed on it with random minimums; no designed case used an amount that large.
- **Tests:** DC-PR-07, DC-PR-13
- **Fix:** none needed now: CR-02's fix (`isWholeCents`, exact) removed both halves. The scoreboard puts back only this half to show which tests catch it.

<!-- mutation -->
