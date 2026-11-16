# Three Real Exploratory Sessions on the Product List

The sample sessions in `sessions/` are made up, to show the format. The three in [sessions/qa-practice-api](../sessions/qa-practice-api) are **real**: each one was run against the [qa-practice-api](../../qa-practice-api) product list on 2026-11-16, and everything in them was seen by sending requests to a running server. This page says what the charters were, what they found, and how to run them again.

## Charters

A charter says what to explore, how, and what kind of problem to look for. Each of these names all three.

| Session | Charter (shortened) | Edge cases found |
|---|---|---:|
| [category-filter](../sessions/qa-practice-api/2026-11-16-category-filter.md) | The category filter, with unusual category names and filter shapes, to find products that exist but cannot be found | 4 |
| [pagination](../sessions/qa-practice-api/2026-11-16-pagination.md) | `page` and `limit`, with boundary values, malformed values and a catalogue that changes between pages, to find skipped, repeated or mis-numbered products | 5 |
| [filter-counts](../sessions/qa-practice-api/2026-11-16-filter-counts.md) | The chip counts against the filter, after creates, edits and deletes and with odd values, to find counts that do not match the list | 3 |

"Edge cases found" is the number of bug, question and risk notes in the session, counted by hand and checked by a test (`npm test`, the last four tests in [session.test.js](../test/session.test.js)).

## Debrief

```
3 session(s), 0 min, 5 bug(s)
```

- **5 bugs**, **6 questions** for the team, **1 risk**, no blockers.
- **The minute clock reads 0.** Each session was a burst of requests that took less than a minute, and the tracker measures time from the start time to the last note time, in whole minutes. So every session shows `0 / 10 min` and counts as *short*. That is true, not a fault in the tracker: nothing here took ten minutes of thinking time. The bugs per hour figure is not worth quoting, so it is not.

## Findings

Every finding has an id, EX-00 to EX-10 (EX-07 was dropped before anything was written under it, and is not reused). Each id has a test in [exploratory-charters.spec.ts](../../qa-practice-api/tests/exploratory-charters.spec.ts).

A **pin** is a test that passes today. It records behaviour a session looked at and judged worth keeping, so changing it later is a decision and not an accident. An **expected failure** (`test.fail`) is a real bug, written as the behaviour it should have. It passes while the bug is there. The day the bug is fixed it fails with "expected to fail but passed", and the fix removes the `test.fail()` line.

| Id | Kind | What was found | Test |
|---|---|---|---|
| EX-00 | Pin | A category with an awkward name (`constructor`, `__proto__`, `C++`, `100%`, `日本語`, `null`) is found by exactly that name | passes |
| EX-01 | **Bug** | A filter that is not one plain string (`category=a&category=b`, `category[]=a`, `category[x]=y`) is ignored, and every product comes back with `200` | expected failure |
| EX-02 | **Bug** | `page=0x10` is read as page 16, because the number is parsed with `parseInt` and no radix | expected failure |
| EX-03 | **Bug** | `page=99999999999999999999` answers `200` with `page: 100000000000000000000`, past the largest exact integer | expected failure |
| EX-04 | Risk, pinned | Paging is by position: a product deleted after page 1 was read moves the next one up, so page 2 skips one | passes |
| EX-05 | **Bug** | `POST /products` accepts `category: 5` with `201`. The "" chip counts it and no filter can reach it | expected failure |
| EX-06 | **Bug** | `PUT /products/:id` stores a category of `null`, `""`, `5`, `["a"]`, `{"x":1}` or `true`, which a create would refuse | expected failure |
| EX-08 | Pin | A page past the last is an empty list with `200`, not an error | passes |
| EX-09 | Pin | Updating a product does not move it in the list | passes |
| EX-10 | Pin | Category names are exact, so `books`, `BOOKS`, `books ` and ` books` are four categories | passes |

Six questions went to the team and are not pinned, because nobody has decided the answer: should names be trimmed and compared ignoring case, should `é` typed two ways be one category, should `category=` (empty) clear the filter or show only uncategorised products, should `page=1.5` and a repeated `page` be a `400`, should there be a limit on name length and on `stock`, and is a page past the last meant to be a `200`.

**Nothing in the product was fixed.** The job was to find and pin. The five bugs are open, each held by an expected failure, so a fix is a small change plus the removal of one line.

## Showing the Test Can Fail

A test that cannot fail proves nothing. EX-02 was fixed on purpose for one run (`parseInt(v, 10)` in `src/routes/query.ts`), and its test reported `Expected to fail, but passed`. The fix was then taken out again. The tracker tests were broken the same way: removing the one RISK line from the pagination session made three of them fail.

## Running It Again

```bash
cd packages/qa-practice-api
npx playwright test tests/exploratory-charters.spec.ts      # 10 tests: 5 pins, 5 expected failures

cd ../exploratory-session-tracker
npm test                                                     # includes the counts of the real sessions
node src/cli.js debrief sessions/qa-practice-api/            # the debrief of the three real sessions
```

Each test makes its own categories, named with the run time, so other tests creating products at the same time cannot change what is checked.
