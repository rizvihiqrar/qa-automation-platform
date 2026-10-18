# Property-based tests and mutation testing of the AI's discount codes

Day 39 of the [case study](README.md). Day 38's [code review](code-review.md) and 126 designed cases checked the AI's code (`d775d20`) at the values a tester picks: boundaries, table rows, one value per class. Two questions were left. What happens at the values nobody picks? And would the tests notice if the code were wrong in a way nobody thought of? Property-based tests answer the first, mutation testing the second.

**In plain English:** instead of choosing test values by hand, a property-based test states a rule ("the total is always the subtotal minus the discount, to the cent") and lets a tool try hundreds of random values against it. Mutation testing then breaks the code on purpose, hundreds of small ways, and counts how many of those breaks the tests notice.

## Result

| | |
|---|---:|
| Property-based tests | 17 |
| Findings | 3 |
| Mutants (small changes to the AI's code) | 412 |
| Detected by the designed cases | 350 (85.0%) |
| Detected by the properties | 321 (77.9%) |
| Detected by both together | 387 (93.9%) |
| Survivors no test can detect (equivalent) | 21 |

| Kind | Findings | What it means |
|---|---:|---|
| defect | 1 | The AI's code did what the spec says it must not (PM-02, missed by the review) |
| spec gap | 1 | The spec didn't cover it, and the code lost cents (PM-01) |
| risk | 1 | Not wrong, but no test can check it (PM-03) |

Properties found the two mistakes; mutation testing found weak tests, not wrong code. The [scoreboard](scoreboard.md) puts every mistake from Days 38 and 39 back and records which technique catches it.

## Property-based tests

17 properties in [`packages/qa-practice-api/tests/properties`](../../packages/qa-practice-api/tests/properties), written with [fast-check](https://fast-check.dev) and run by `node --test` (`npm run test:properties`, about 10 seconds, part of the qa-practice-api CI job). The first 13 were written before mutation testing, DC-PR-14 to 17 after it (below). Each test title starts with its ID and the rules it checks, like the designed cases.

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
| DC-PR-14 | DC-R01, DC-R03 to DC-R08, DC-R10 | Creating a percent or fixed code with any JSON value in any one field (the usual values, a past date, the same value wrapped in a list or an object, or anything at all): 201, or a 400/404/409 with a non-empty `error`; never a 500 |
| DC-PR-15 | DC-R11 | Changing a code with any body: 200 with valid stored values, or a refusal with a non-empty `error` |
| DC-PR-16 | DC-R06, DC-R21 | A `max_uses` of 11 to 14 allows exactly that many orders, and `uses` reaches it |
| DC-PR-17 | DC-R05, DC-R15 | A code that expires any time from a minute to 50 years ahead can be used now |

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

### PM-03 Expiry at the exact millisecond can't be tested

- **Rule:** DC-R05
- **Kind:** risk
- **Where:** `src/routes/discounts.ts` lines 49 and 170, `Date.now()` (`d775d20`)
- **Found by:** mutation testing: changing `<=` to `<` in either expiry check survived every test
- **What happened:** DC-R05 says a code expires *at* `expires_at`, not a millisecond later. The code is right, but it reads the clock itself, so no test can make "now" equal `expires_at` exactly: a request takes longer than a millisecond. The designed cases test a code that has just expired and one that hasn't, never the instant itself.
- **Tests:** none
- **Fix:** none yet. Passing a clock into the code (or using fake timers in tests that import it) would let a test set now to exactly `expires_at`. Recorded rather than changed, since the AI's code meets the rule.

## Mutation testing

[Stryker](https://stryker-mutator.io) 10 changed the AI's code one small way at a time, 412 ways in all (`src/money.ts`, `src/routes/discounts.ts`, and the part of `POST /orders` the AI wrote), and ran the tests against each change: `<` for `<=`, a condition replaced by `true`, an error message emptied, a regular expression loosened. A change the tests don't notice "survives", and points at something the tests run but don't really check. Mutation testing doesn't find bugs in the code; it finds tests that would miss them.

Playwright has no Stryker runner, so Stryker's command runner runs each test set whole for every mutant ([`stryker.config.mjs`](../../packages/qa-practice-api/stryker.config.mjs)). The two sets ran separately, so they can be compared, and a mutant counts as detected by both together when either set detected it ([`scoreboard/mutation-summary.mjs`](../../packages/qa-practice-api/scoreboard/mutation-summary.mjs)).

| Tests | Detected | Score |
|---|---:|---:|
| The Playwright suite (126 designed cases and 165 earlier tests) | 350 of 412 | 85.0% |
| The first 13 properties | 271 of 412 | 65.8% |
| All 17 properties | 321 of 412 | 77.9% |
| **Designed cases and all 17 properties together** | **387 of 412** | **93.9%** |
| The same, leaving out the 21 equivalent mutants (below) | 387 of 391 | 99.0% |

The two techniques overlap far less than their scores suggest: 68 mutants were caught only by the designed cases (mostly refusals: wrong types, bad codes, access control) and 37 only by the properties (mostly arithmetic and edges no case picked).

### What it showed, and what changed

The first combined run left 54 survivors. Each was read against the code. Most pointed at checks the tests ran but didn't make, and DC-PR-14 to 16 were written for them (none of these was a bug in the code; each is a mistake a future change could make without any test noticing):

- **Refusal messages:** against the designed cases, 30 mutants across 16 different refusals emptied the error message or sent the refusal without `error` at all, and every case passed: for those refusals they check the status code only. DC-PR-14 and 15 now require a non-empty message on every refusal; DC-PR-12 checks the message on its 409.
- **A list instead of a string:** without the `typeof` check, `expires_at: ["2027-01-01T00:00:00Z"]` passes the date pattern (a list reads as its text) and crashes with a 500. No test sent a value wrapped in a list; DC-PR-14 does.
- **`uses` past 10:** dropping the page size in the use count (the store's default page is 10) went unnoticed, because no test used a code more than 10 times. With it dropped, a code with `max_uses` of 12 could be used without limit after 10. DC-PR-16.
- **A misreading, kept honest:** DC-PR-17 (a code that expires in the future can be used) was written for what looked like "every code with an expiry counts as expired" surviving. Checked against the report, that mutant was caught by the designed cases; the one that survived is equivalent (see below). DC-PR-17 stays as a cheap extra check, but it closed no gap.
- **A PATCH that stores the error:** skipping the check on `active` in a PATCH stored the error object as the value and answered 200. DC-PR-15 accepted any 200; it now checks the stored values.
- **Starting points:** DC-PR-14 always started from a percent code, so the fixed-value refusal was never reached, and it never sent a past date. It now starts from either kind and sends one.

Each new or tightened property was checked by making its mutant by hand: the property failed every time.

### What still survives (25)

| Survivors | Why no test can catch them |
|---:|---|
| 21 | **Equivalent:** the change can't alter what the API does, because another check already refuses the same input. Loosening the date patterns (`Date.parse` and the format pattern refuse the rest); the `typeof` checks before `Number.isFinite`, which already refuses non-numbers; checking that the PATCH body is an object (`express.json` only ever hands over an object or a list); `expires_at !== null` before `Date.parse(null)`, which is `NaN`, so never expired; a percent value going through the fixed-value check (1 to 100 always passes it); the route path `'/'` emptied (Express treats both alike) |
| 2 | **The exact millisecond of expiry** (finding PM-03) |
| 2 | **The separators in one error message** (`, ` emptied in the list of fields PATCH accepts). Message wording isn't checked, by choice |

### Two things learned running it

- **Running several mutants at once gave wrong answers.** With three Stryker workers each starting its own API server and four Playwright workers each, a mutant that refuses every fixed-value code "survived", and a harmless one was "killed". The same changes made by hand gave the right answers, and so did Stryker running one mutant at a time. The Playwright set now runs alone (about 50 minutes); the properties start no server and run four at a time (about 28 minutes). The parallel run had reported 93.4% for the designed cases; the true figure is 85.0%.
- **Incremental runs, without stale results.** The weekly [Mutation workflow](../../.github/workflows/mutation.yml) keeps each run's results and tests only mutants whose code changed. Stryker can't see test changes through the command runner (it reuses every result whose code is unchanged), so the results file is named after a hash of the tests, configs and other source: change a test and the next run is a full one.
