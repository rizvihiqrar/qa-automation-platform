# k6-performance

[k6](https://k6.io) smoke, load and spike tests for [qa-practice-api](../qa-practice-api), with pass/fail thresholds per endpoint. The runner starts the API, runs the tests, stops it, and reports the results.

**In plain English:** functional tests check that the app gives the right answer. Performance tests check that it still does when many people use it at once, and fast enough.

---

## It Found a Real Performance Bug

The first load run passed every threshold, but the numbers looked wrong:

| | Spike (40 users, browsing only) | Load (20 users, some logging in) |
|---|---:|---:|
| `list products` p95 | 0.6 ms | **67 ms** |
| `get product` max | 2 ms | **90 ms** |
| `login` average | — | 72 ms |

Half the users, yet browsing was about 100 times slower, and the delays matched the time a login took. That pointed at password hashing: `bcryptjs.compareSync` and `hashSync` run on Node's single main thread, so while one login hashed, every other request waited.

**First fix, which didn't work:** switching to bcryptjs's async functions changed nothing (list p95 still 67–84 ms over three runs). bcryptjs's async mode only yields between chunks of up to 100 ms of work, and one hash takes about 70 ms, so it still ran as one blocking piece.

**Confirming the cause:** the same load run with logins switched off (`LOGIN_EVERY=0`) gave a list p95 of **3 ms**; with logins on, **69 ms**.

**The fix:** hash with Node's built-in `crypto.scrypt`, which runs in a background thread pool, and remove bcryptjs. Three runs each:

| | Before | After |
|---|---:|---:|
| `list products` p95 | 67–84 ms | **1.0 ms** |
| `get product` p95 | 2–68 ms | **1.0 ms** |
| `login` average | 71–86 ms | **39–43 ms** |
| Throughput | 70–73 req/s | **77 req/s** |
| Errors | 0% | 0% |

The API's own 34 tests and the 20-step contract check still pass. A unit test in qa-practice-api now guards the cause directly (see the [root-cause analysis](../../docs/rca/01-login-hashing-blocked-the-api.md)).

**Lesson about thresholds:** the original limit for browsing (p95 under 250 ms) passed the slow version, because it was a guess. The thresholds are now set from the measured baseline (p95 under 50 ms for browsing), which the old 67–84 ms would fail.

---

## The Tests

| Test | Shape | What it checks |
|---|---|---|
| `smoke` | 1 user, 10 s, full journey | The scripts and the API work at all |
| `load` | ramp to 20 users, hold, ramp down; 1 in 4 iterations logs in and orders | Normal traffic stays fast |
| `spike` | 2 → 40 users in 3 s, hold, drop | A sudden burst doesn't cause errors |

Every request is tagged by endpoint (`list products`, `get product`, `login`, `place order`), so each has its own threshold and its own line in the report.

Thresholds: errors under 1%, checks over 99%, plus a p95 limit per endpoint.

---

## Usage

```bash
npm ci --prefix ../qa-practice-api
npm run perf              # smoke, load and spike (about 90 s)
npm run perf:ci           # smoke and load, used in CI
node src/run.js load --url http://localhost:4000      # an API that's already running
LOGIN_EVERY=0 node src/run.js load                    # load without logins
```

Needs [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) on the PATH, or `K6_BIN` pointing at it. Results go to `results/` (`REPORT.md` plus k6's JSON per test). In GitHub Actions the report is added to the job summary. Exit code 1 if any threshold fails.

---

## Tests

```bash
npm test   # 5 tests for the report builder, using a real k6 summary as the fixture
```
