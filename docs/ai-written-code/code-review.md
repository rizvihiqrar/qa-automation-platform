# Code review of the AI's discount codes

Day 38 of the [case study](README.md). The code under review is commit `d775d20`, written by an AI from the [reviewed spec](spec.md) and committed unedited (see the [AI run](ai-run/README.md)). It was reviewed rule by rule against the spec, then tested with 126 designed cases in [`packages/qa-practice-api/tests/discounts`](../../packages/qa-practice-api/tests/discounts), each naming the rule it checks. The cases were run against the AI's code before anything was fixed.

**In plain English:** the AI's code passed every check it was given on Day 37. Reading it against the spec and testing the edges found four places where it does something the spec says it must not, plus one gap in the spec itself. All are fixed, and each fix has a test that fails if the mistake comes back.

## Result

| | |
|---|---:|
| Rules reviewed | 25 |
| Rules the AI's code broke | 5 |
| Designed test cases | 126 |
| Cases that failed on the AI's code | 12 |
| Findings | 8 |

| Kind | Findings | What it means |
|---|---:|---|
| defect | 4 | The code does what the spec says it must not |
| spec gap | 1 | The spec didn't cover it; the code's choice changed existing behaviour |
| risk | 3 | Not wrong today, but fragile; recorded, with a test where one helps |

Every finding was first suspected while reading the code. Each defect and the spec gap was then confirmed by a designed case that fails on `d775d20` and passes on the fix. What the reading and these cases both missed is Day 39's question (property-based tests and mutation testing).

## Findings

### CR-01 Impossible dates accepted as expires_at

- **Rule:** DC-R05
- **Kind:** defect
- **Where:** `src/routes/discounts.ts` line 44, `parseExpiresAt` (`d775d20`)
- **Found by:** code review (the format is checked with a pattern, the date with `Date.parse`); confirmed by boundary values on calendar edges
- **What happened:** `Date.parse` rolls an impossible date over instead of refusing it. `2027-02-29`, `2028-02-30` and `2027-04-31` were accepted and returned as written, so the API showed a date that doesn't exist while the code expired on the rolled-over day (1 March, 1 March, 1 May). Month 13 and second 60 were refused, because `Date.parse` does refuse those.
- **Tests:** DC-BVA-25, DC-BVA-26, DC-BVA-27, DC-EP-30
- **Fix:** the date and time must read back unchanged after parsing (`isRealDateTime`)

### CR-02 Amounts with more than two decimals accepted

- **Rule:** DC-R04, DC-R07
- **Kind:** defect
- **Where:** `src/routes/discounts.ts` line 19, `hasAtMostTwoDecimals` (`d775d20`)
- **Found by:** code review (a tolerance inside a two-decimal check); confirmed by boundary values one step past two decimals
- **What happened:** the check allowed `n * 100` to be up to 0.000000001 away from a whole number, to cope with 0.29 × 100 being 28.999999999999996. That tolerance also let through `10.000000000001`, `0.1 + 0.2` (0.30000000000000004) and a minimum of `49.999999999999`. The last is the worst: the API stored and showed a minimum of 49.999999999999, while orders were checked against 50.00 (the minimum rounded to cents) and the refusal message said 50.00. Three places, two different minimums.
- **Tests:** DC-BVA-14, DC-BVA-15, DC-BVA-19
- **Fix:** exact check in `src/money.ts`: a value is in whole cents when rounding it to cents gives back the same number (`isWholeCents`)

### CR-03 A bad discount_code hid the item errors

- **Rule:** DC-R15
- **Kind:** defect
- **Where:** `src/routes/orders.ts` line 51 (`d775d20`)
- **Found by:** code review (the order of checks against DC-R15); confirmed by a decision table combining bad items with a bad code
- **What happened:** DC-R15 says the existing item and stock checks run first and keep their responses. The AI checked the type of `discount_code` before the items, so an order for an unknown product with `discount_code: 5` got `400 discount_code must be…` instead of `404 Product … not found`, and a zero quantity or too little stock got the discount message instead of their own.
- **Tests:** DC-DT-12, DC-DT-13, DC-DT-14
- **Fix:** the `discount_code` check moved after the item loop

### CR-04 PATCH with a list for a body changed nothing and said 200

- **Rule:** DC-R11
- **Kind:** defect
- **Where:** `src/routes/discounts.ts` line 131, `const body = req.body ?? {}` (`d775d20`)
- **Found by:** code review (what `Object.keys` returns for a non-object); confirmed by equivalence partitioning on the body's type
- **What happened:** unknown fields were found with `Object.keys(body)`, which is empty for `[]`, so `PATCH /discounts/{code}` with `[]` passed every check and answered 200. The spec allows only the three fields; a client sending the wrong shape was told its change worked.
- **Tests:** DC-EP-27
- **Fix:** anything other than a JSON object is a 400

### CR-05 Product prices not in whole cents changed order totals

- **Rule:** DC-R16
- **Kind:** spec gap
- **Where:** `src/routes/orders.ts` line 78, `toCents(product.price) * quantity` (`d775d20`)
- **Found by:** code review (rounding each price before multiplying); confirmed by boundary values on the product price
- **What happened:** the spec says amounts are dollars with cents, but the products API never required it: 19.999 and 0.333 were valid prices. The AI rounded each price to cents before multiplying, which is right for whole-cent prices but changed what existing orders cost: three at 0.333 came to 1.00 before `d775d20` and 0.99 after. None of the 165 existing tests noticed, because none used a price with more than two decimals.
- **Tests:** DC-BVA-43
- **Fix:** product prices must be in whole cents (400 otherwise, on create and update), so price × quantity is exact again

### CR-06 Nothing checks the request half of the API document

- **Rule:** DC-R25
- **Kind:** risk
- **Where:** `packages/api-drift-checker/spec/qa-practice-api.openapi.json` (`d775d20`)
- **Found by:** code review of the OpenAPI document; the drift check covers responses only
- **What happened:** the AI's document is accurate where it is checked: with twelve `/discounts` steps added to the drift scenario, all 39 responses match it and no operation goes uncalled. Its request schemas say less than the rules, though (no maximum of 100 for a percent, no two-decimal limit, nothing about trimming), and no tool reads them.
- **Tests:** none
- **Fix:** each request field now states its rule in a `description`. The request schemas stay unchecked; the designed cases cover the rules themselves.

### CR-07 uses is worked out by reading every order

- **Rule:** DC-R21
- **Kind:** risk
- **Where:** `src/routes/discounts.ts` line 25, `countingOrders` (`d775d20`)
- **Found by:** code review
- **What happened:** `uses` is not stored; it is counted from the orders each time. That makes cancelling give a use back with no extra code, and `uses` can never drift from the orders. But `GET /discounts` reads every order once per code, and every order with a code reads every order. Fine for this in-memory store; on a database it would be an indexed count.
- **Tests:** none
- **Fix:** accepted for the demo store; revisit when the API moves to Postgres (Day 49)

### CR-08 The last use is safe only while checking and saving can't interleave

- **Rule:** DC-R21
- **Kind:** risk
- **Where:** `src/routes/discounts.ts` line 163, `checkDiscount`, and its caller in `src/routes/orders.ts` (`d775d20`)
- **Found by:** code review; a concurrency case guards it
- **What happened:** the limit is checked, then the order is saved. Both happen in one synchronous block, so Node can't run another order in between, and ten customers sending orders for the last use at once get one 201 and nine 422s. With a database the check and the insert would be separate round trips, and two orders could both see one use left.
- **Tests:** DC-ST-06
- **Fix:** accepted; DC-ST-06 will fail if the check and the save are ever split

## What the AI got right

Reading the code was not only a search for mistakes. These are the places a reviewer would expect slips, and the AI had none:

- **Money in cents.** Discounts and totals are worked out in whole cents with half a cent rounding up: 10% of 10.05 is 1.01, and three items at 0.10 with 100% off come to exactly 0.00 (DC-BVA-36 to 41, DC-EX-01 to 06).
- **The refusal order.** All eleven rows of the decision table on the five DC-R15 conditions, including the ones where two conditions hold at once, give the expected message, and a refused order takes no stock, counts no use and creates no order (DC-DT-01 to 11).
- **No probing.** An unknown code and a turned-off code get the same message.
- **`total` kept its meaning**, with `subtotal` and `discount` added beside it.
- **Uses counted from orders**, so cancelling gives a use back and `max_uses` can't be set below the uses already counted (409, with nothing changed).
- **PATCH checks everything before changing anything.**

## Rule coverage

Every rule has at least one case. A rule is marked broken when a defect above names it.

| Rule | Cases | AI's code |
|---|---:|---|
| DC-R01 | 11 | met |
| DC-R02 | 1 | met |
| DC-R03 | 2 | met |
| DC-R04 | 12 | broken (CR-02) |
| DC-R05 | 17 | broken (CR-01) |
| DC-R06 | 4 | met |
| DC-R07 | 5 | broken (CR-02) |
| DC-R08 | 2 | met |
| DC-R09 | 2 | met |
| DC-R10 | 14 | met |
| DC-R11 | 8 | broken (CR-04) |
| DC-R12 | 1 | met |
| DC-R13 | 4 | met |
| DC-R14 | 1 | met |
| DC-R15 | 15 | broken (CR-03) |
| DC-R16 | 5 | met |
| DC-R17 | 6 | met |
| DC-R18 | 6 | met |
| DC-R19 | 1 | met |
| DC-R20 | 1 | met |
| DC-R21 | 3 | met |
| DC-R22 | 2 | met |
| DC-R23 | 2 | met |
| DC-R24 | 1 | met |
| DC-R25 | drift check | met |

The cases, by technique:

| Technique | IDs | Cases |
|---|---|---:|
| Boundary values | DC-BVA | 43 |
| Decision tables | DC-DT | 21 |
| Equivalence partitioning | DC-EP | 36 |
| Access control | DC-AC | 14 |
| State transitions of uses | DC-ST | 6 |
| The spec's worked examples | DC-EX | 6 |

## How the tests were checked

- **Against the AI's code first.** All 126 cases were run on `d775d20` before any fix: 12 failed, exactly the cases listed under CR-01 to CR-05; the other 114 passed.
- **After the fixes:** the whole qa-practice-api suite passes, 291 of 291 (the 165 earlier tests plus these 126), and the discount cases passed 630 of 630 over five repeats.
- **Each mistake put back.** Each fix was undone on its own and the whole suite run: each one failed exactly the cases its finding lists and nothing else.
- **The API document.** The drift scenario grew from 27 to 39 steps, twelve of them on discount codes; all 39 responses match the AI's document.
