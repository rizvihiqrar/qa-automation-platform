# Root-cause analyses

One page per real bug found while building this repo. Each covers the symptom, how it was found, the root cause in the code, the fix, the regression tests that keep it fixed, and what changed so the same kind of bug is caught earlier next time.

**In plain English:** when something breaks, fixing it is half the job. The other half is understanding why it broke, proving it can't quietly come back, and changing how the work is done so similar bugs are caught sooner.

| # | Bug | Found by | Impact |
|---:|---|---|---|
| 1 | [Logins blocked the whole API](01-login-hashing-blocked-the-api.md) | k6 load test with every threshold green | Every request waited behind each login: browsing p95 67–84 ms instead of 1 ms |
| 2 | [Duplicate webhook processed twice](02-duplicate-webhook-processed-twice.md) | Concurrency test written with the receiver | An event (a payment, an email) could run twice. Writing this page found a second bug: the sender gave up on `409` and could lose the event |
| 3 | [Windows line endings rejected every SQL check](03-crlf-rejected-every-sql-check.md) | Running the tests on Windows | The tool refused to start on Windows; CI on Linux stayed green |
| 4 | [A mistyped tag passed green](04-mistyped-tag-passed-green.md) | Checking what a wrong tag does | A smoke run could test nothing and still pass |
| 5 | [Live tokens in published reports](05-tokens-in-published-reports.md) | A scan written before the first publish | 19 access and refresh tokens per Postman report would have gone public |

## What writing these found

Writing each page meant going back to the code and putting the bug back to see whether a test failed. That turned up more than expected:

- **Bug 1:** the only guard was a k6 load test that needs k6 installed and a minute of load. A new unit test checks the cause directly in about a second: event-loop utilization while hashing is 0–11% with the fix and 100% with either earlier version (sync bcryptjs, and the async bcryptjs that didn't help).
- **Bug 2:** a **new bug**. The sender treated the receiver's `409 in-progress` as final. In the usual way duplicates happen (a retry after a timeout), a slow first attempt that then failed meant the event was never processed. Reproduced end to end, fixed, and tested.
- **Bug 4:** the guard that fixed it had no test of its own. Now it does (4 tests), and removing the guard's `exit(1)` makes two of them fail.
- **Bug 5:** the published pages were clean, but the raw CI artifact still held the tokens. The Postman report now leaves them out at the source.

## Re-checked by putting each bug back

| # | Bug put back | Result |
|---:|---|---|
| 1 | Sync hashing; async bcryptjs 2.4.3 | New unit test fails both (100% busy) |
| 2 | In-progress guard removed | `two copies of one delivery arriving together are processed once` fails |
| 2b | Sender stops on `409` | New end-to-end test fails: attempts `[network error, 409]`, event never processed |
| 3 | Split on `\n` only | 6 tests fail on Windows, including the CRLF test, which also fails on Linux |
| 4 | Guard's `exit(1)` removed | 2 of the 4 new guard tests fail |
| 5 | JWT pattern disabled | 3 report tests fail |

`scripts/rca.test.mjs` (root `npm test`, run in CI) keeps these pages honest: every page has all the sections, every link resolves, and every regression test named here still exists under that name.

## Template

Copy [TEMPLATE.md](TEMPLATE.md) for the next one.
