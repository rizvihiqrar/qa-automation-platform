# Test strategy: qa-practice-api

**In plain English:** before writing more tests for the shop API, list what could go wrong, score how likely and how costly each problem would be, and spend testing effort in that order. The cases themselves come from named test design techniques instead of guesswork. Designing them this way found 9 defects in an API that already had 38 passing tests.

| | |
|---|---|
| **System under test** | [qa-practice-api](../../packages/qa-practice-api): users, products and orders over REST, JWT sign-in, in-memory data |
| **Test plan** | [test-plan.md](test-plan.md): 12 requirements, 85 designed cases, each tied to a technique and a requirement |
| **Designed tests** | [packages/qa-practice-api/tests/design](../../packages/qa-practice-api/tests/design), run in CI with the rest of the package |
| **Traceability** | [Live matrix](https://rizvihiqrar.github.io/qa-automation-platform/reports/traceability/): risk → requirement → case → result in the latest CI run on main, rebuilt after every run ([how it's built](../../packages/ci-dashboard/README.md#traceability-matrix)) |
| **Kept honest by** | [scripts/test-plan.test.mjs](../../scripts/test-plan.test.mjs): every case in the plan exists as a test and the reverse, every case cites a requirement, every high risk has tests or a scheduled day |

## Scope

In scope: the 17 routes in the [API reference](../../packages/qa-practice-api/README.md#api-reference), their input rules, the order lifecycle and stock, and the error contract (`{ error }` JSON on every failure).

Out of scope here, and where it is covered instead:

| Area | Where |
|---|---|
| Authorization in depth (roles, other users' data, rate limits), security scanning | Day 36 |
| Load and latency | [k6-performance](../../packages/k6-performance) |
| Response shapes against the OpenAPI spec | [api-drift-checker](../../packages/api-drift-checker) |
| Decimal money, concurrent writes against a real database | Days 43–45 and 49 |
| Durability across restarts | Not tested: the store is in memory by design |

## How risks are scored

Each risk gets a **likelihood** (how probable the defect is, given the code and its history) and an **impact** (what it costs if it reaches users), each from 1 to 3. Score = likelihood × impact.

| Score | Level | What it gets |
|---|---|---|
| 6–9 | High | Designed cases at API level before release, or a named day when they will be written |
| 3–4 | Medium | At least one test, or a written reason for accepting it |
| 1–2 | Low | Covered when cheap, otherwise accepted |

Likelihood was scored from reading the code before testing, then checked by probing the running API; a risk confirmed by a probe was set to 3.

## Risk register

| ID | Risk | L | I | Score | Tested by | Status |
|---|---|---:|---:|---:|---|---|
| R-01 | Order status moves the business would never allow (delivered back to pending, cancelled to shipped), and a cancelled order keeps its stock | 3 | 3 | 9 | TC-ST-01 to TC-ST-29 | Found, fixed |
| R-02 | A user changes their email to one another account already uses, so two accounts share it and sign-in picks the older one | 3 | 3 | 9 | TC-DT-01 to TC-DT-08 | Found, fixed |
| R-03 | Any signed-in user can change the price of, or delete, any product | 3 | 3 | 9 | Day 36 | Open, scheduled |
| R-04 | Stock oversold or left wrong after an order, including fractional quantities | 3 | 3 | 9 | TC-BVA-07 to TC-BVA-12, TC-EP-11 to TC-EP-15, TC-DT-14, [orders.spec.ts](../../packages/qa-practice-api/tests/orders.spec.ts) | Found, fixed |
| R-05 | Bad product data stored: an empty string saved as price 0, `true` as 1 | 3 | 2 | 6 | TC-EP-01 to TC-EP-10, TC-BVA-01 to TC-BVA-06 | Found, fixed |
| R-06 | A deleted user's token still places orders and edits products | 3 | 2 | 6 | Day 36 | Open, scheduled |
| R-07 | Customers can mark their own orders shipped or delivered (no role check on status changes) | 3 | 2 | 6 | Day 36 | Open, scheduled |
| R-08 | One user can read another user's orders | 2 | 3 | 6 | Day 36 (the code returns 404, checked by reading; no test yet) | Open, scheduled |
| R-09 | Sign-in has no rate limit, so passwords can be guessed at speed | 3 | 2 | 6 | Day 36 | Open, scheduled |
| R-10 | Password hashing blocks the server while users sign in | 2 | 3 | 6 | [password.spec.ts](../../packages/qa-practice-api/tests/password.spec.ts), k6 thresholds | Covered |
| R-11 | Malformed input crashes a route or returns an HTML page instead of JSON | 3 | 2 | 6 | TC-EP-15, TC-EP-17 to TC-EP-20 | Found, fixed |
| R-12 | Order totals wrong from floating-point arithmetic | 2 | 2 | 4 | TC-DT-13 | Partly covered: see below |
| R-13 | Responses drift from the documented contract | 2 | 2 | 4 | api-drift-checker live check | Covered |
| R-14 | Password hashes leak in user responses | 1 | 3 | 3 | [users.spec.ts](../../packages/qa-practice-api/tests/users.spec.ts) | Covered |
| R-15 | Two orders for the last unit both succeed | 1 | 3 | 3 | None needed today: the check and the write run with no `await` between them, so requests can't interleave | Accepted until Day 49 |
| R-16 | Email format isn't validated at sign-up | 3 | 1 | 3 | None | Accepted |
| R-17 | Lists skip or repeat items at page edges; limit=0 clamped differently from limit=-1 | 3 | 1 | 3 | TC-BVA-13 to TC-BVA-22 | Found, fixed |
| R-18 | Data lost on restart | 3 | 1 | 3 | None | Accepted: in-memory by design |

**R-12 in detail.** Totals are rounded with `Math.round(total * 100) / 100`. That fixes `0.1 × 3` (TC-DT-13 guards it) but not every case: a price of 1.005 totals 1.00, because 1.005 × 100 is 100.49999… in floating point. Prices with three decimals are unusual, so this is accepted here; Days 43–45 build a money-handling API on decimal amounts and test this class of bug directly.

**R-15 in detail.** Node runs each request handler to completion unless it awaits. The order route checks and takes stock with no `await` in between, so two requests can't both see the last unit. That stops being true once the store is a real database with async calls, which is why it is accepted only until Day 49 (Postgres via Testcontainers).

## Test levels

| Level | What it proves | Where |
|---|---|---|
| Unit | Password hashing is correct and stays off the event loop | `tests/password.spec.ts` |
| API, functional | Each route's rules, from the outside, over HTTP | `tests/*.spec.ts` (38 tests, written first) and `tests/design/*.spec.ts` (85 designed cases) |
| Contract | Every response matches the OpenAPI spec | [api-drift-checker](../../packages/api-drift-checker) |
| Performance | Latency under load stays within measured thresholds | [k6-performance](../../packages/k6-performance) |
| Security | Authorization, rate limits, a ZAP baseline scan | Day 36 |

API level is where most of the effort goes. The rules live in route handlers, and every client sees them through HTTP, so testing there catches wiring mistakes (a missing check on one route) that unit tests of a shared helper would miss. That is how the Day 19 bug, PUT skipping the validation POST had, went unnoticed.

## Test design techniques

| Technique | Used for | Why this technique | Cases |
|---|---|---|---:|
| Equivalence partitioning | Types of price, stock, quantity, order lines, request bodies, sign-in fields | JSON lets any field be any type; one case per class finds coercion bugs without trying every value | 20 |
| Boundary value analysis | Price ≥ 0, stock ≥ 0, 1 ≤ quantity ≤ stock, limit 1–50, page 1 to last | Off-by-one and clamping bugs sit on the edges of ranges | 22 |
| Decision tables | Updating a user (who, exists, valid, email taken); placing an order (signed in, valid, exists, in stock) | Outcomes depend on several conditions at once, and the order the checks run in matters | 14 |
| State transitions | Order lifecycle: all 25 (from, to) pairs, plus stock on cancel | A status field with no transition rules accepts every move; only trying the invalid ones shows that | 29 |

Details, partitions and the exact cases: [test-plan.md](test-plan.md).

## Entry and exit criteria

A change to qa-practice-api **starts testing** when it type-checks and the server answers `GET /health` with 200.

It **can merge** when:
- every test in the package passes in CI (123 today, with no retries);
- the drift checker reports 0 drifted responses;
- the k6 thresholds hold;
- every High risk in the register has tests or a scheduled day (enforced by `scripts/test-plan.test.mjs`).

## Test data and environments

Each designed test signs up its own user and creates its own products, with unique emails and a unique category where it counts items. Nothing depends on seed data or on another test having run, so the 123 tests run in parallel (4 workers, about 4 seconds locally). CI runs them on Ubuntu with Node 24 against a fresh in-memory server.

## Results

Designing cases this way found 9 defects that the 38 existing tests missed. All are fixed, with the designed cases as their regression tests. Running the 85 cases against the code before the fixes: 44 pass and 41 fail. Of the 41, 38 fail on a defect, 2 on the new numbers-only rule below, and 1 (TC-EP-14) only on a reworded error message.

| # | Defect | Technique | Cases that catch it |
|---:|---|---|---|
| 1 | Any status could be set from any status; delivered orders went back to pending, cancelled orders shipped | State transitions | TC-ST-01, 03, 04, 06, 07, 09, 11–13, 15–25, 28 |
| 2 | Cancelling an order kept its stock | State transitions | TC-ST-26, TC-ST-27 |
| 3 | `PUT /users/:id` accepted another account's email, and an empty name | Decision table | TC-DT-04 to TC-DT-06 |
| 4 | Price `""` stored as 0, `true` as 1, `[5]` as 5; stock `""` as 0 | Equivalence partitioning | TC-EP-03, 04, 06, 08 |
| 5 | Quantity 1.5 accepted, leaving stock at 8.5 | Equivalence partitioning | TC-EP-13 |
| 6 | Quantities sent as strings were joined as text: `"2"` + `"3"` checked as 23 against stock | Equivalence partitioning | TC-EP-12 |
| 7 | A `null` order line crashed the route with a 500 HTML page | Equivalence partitioning | TC-EP-15 |
| 8 | A malformed JSON body got an HTML error page; a numeric password at sign-up or sign-in got a 500 | Equivalence partitioning | TC-EP-17 to TC-EP-20 |
| 9 | `limit=0` gave 10 items per page while `limit=-1` gave 1 | Boundary values | TC-BVA-14 |

**One rule decided rather than found:** prices, stock and quantities must be JSON numbers. Before, numeric strings like `"12.5"` were converted, which is where defects 4 and 6 came from. TC-EP-02 and TC-EP-09 pin the decision.

**Order status rules, as decided:** pending → processing or cancelled; processing → shipped or cancelled; shipped → delivered; delivered and cancelled are final. A move outside these returns `409` and changes nothing. The drift checker's scenario used to jump from pending to shipped; it now goes through processing and also checks the `409`.

**Testability gap:** there's no way to create an admin through the API, so the "or admin" rules on `PUT` and `DELETE /users/:id` can't be tested from outside. Day 36 adds a way to seed one for tests.
