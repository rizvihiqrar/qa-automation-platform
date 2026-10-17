# Logins blocked the whole API

| | |
|---|---|
| **Where** | [qa-practice-api](../../packages/qa-practice-api), password hashing in the auth routes |
| **Found by** | [k6 load test](../../packages/k6-performance), Day 11. Every threshold passed |
| **Impact** | While any user logged in, every other request waited. Browsing p95 67–84 ms instead of about 1 ms. No errors, so nothing alerted |
| **Fixed in** | Commit `4b831e7` (Day 11); unit-level guard added on Day 31 |

## Symptom

The first load run was green, but two runs didn't make sense side by side:

| | Spike: 40 users, browsing only | Load: 20 users, 1 in 4 iterations logs in |
|---|---:|---:|
| `list products` p95 | 0.6 ms | **67 ms** |
| `get product` max | 2 ms | **90 ms** |
| `login` average | n/a | 72 ms |

Half the users, yet browsing was about 100 times slower. The slow requests took about as long as one login.

## How it was found

1. **Compare, don't just check pass/fail.** Every threshold passed. The clue was the spike run being faster with twice the users.
2. **Match the numbers.** The extra delay on browsing (~70 ms) matched the login time (72 ms). Something in login was holding up unrelated requests.
3. **Isolate with one variable.** The load script already had a `LOGIN_EVERY` setting. Same run, logins off: list p95 **3 ms**. Logins on: **69 ms**.
4. **Read the code.** Login and register hashed with `bcryptjs`.
5. **Dead end, measured.** Switching to bcryptjs's async functions changed nothing (list p95 still 67–84 ms over three runs).

## Root cause

Node runs JavaScript on one main thread. `bcryptjs` is pure JavaScript, so hashing runs on that thread:

```js
// src/routes/auth.js, before
if (!user || !bcrypt.compareSync(password, user.password)) {
```

One hash at cost 10 took about 70 ms. For those 70 ms the server could not start on any other request, so every request that arrived during a login waited for it.

The async version didn't help because bcryptjs's async mode only yields between chunks of up to 100 ms of work. One hash fits in one chunk, so it still ran as a single blocking piece.

**Why it wasn't caught earlier:** the 34 API tests send one request at a time, so nothing ever waited behind a login. The first k6 thresholds (browsing p95 under 250 ms) were a guess, and 67–84 ms passed them.

## Fix

Hash with Node's built-in `crypto.scrypt`, which runs in libuv's thread pool, off the main thread, and remove bcryptjs ([src/security/password.ts](../../packages/qa-practice-api/src/security/password.ts)). Comparison uses `timingSafeEqual`.

| Three runs each | Before | After |
|---|---:|---:|
| `list products` p95 | 67–84 ms | **1.0 ms** |
| `get product` p95 | 2–68 ms | **1.0 ms** |
| `login` average | 71–86 ms | **39–43 ms** |
| Throughput | 70–73 req/s | 77 req/s |

Making register async opened a new gap: two registrations with the same email could both pass the "email in use?" check while hashing. The fix checks again after hashing.

Rejected: raising bcrypt's chunking, or moving hashing to a worker pool by hand. Both add code to work around a library, when Node has a non-blocking hash built in.

## Regression tests

- [`packages/qa-practice-api/tests/password.spec.ts`](../../packages/qa-practice-api/tests/password.spec.ts) › `hashing does not block the event loop`
- [`packages/qa-practice-api/tests/password.spec.ts`](../../packages/qa-practice-api/tests/password.spec.ts) › `a hash verifies its own password and rejects others`
- [`packages/k6-performance/k6/load.js`](../../packages/k6-performance/k6/load.js) › `'http_req_duration{name:list products}': ['p(95)<50']`

The unit test measures event-loop utilization (the share of time the main thread was busy) while eight logins' worth of hashing runs. Put back:

| Version | Busy | Result |
|---|---:|---|
| Fixed (`crypto.scrypt`), 40 runs in parallel | 0–11% | pass 40/40 |
| `scryptSync` on the main thread | 100% | fail 10/10 |
| bcryptjs 2.4.3 async (the fix that didn't work) | 100% | fail 5/5 |

A first version of this test timed a 5 ms timer instead and was flaky (20 of 40 failed under parallel load): Windows timers tick about every 15 ms, and parallel workers starve each other's timers. Utilization barely moves under CPU contention, so it replaced the timer.

The k6 threshold is the end-to-end guard: CI runs the load test, and 67–84 ms fails a 50 ms limit.

## Prevention

- **Thresholds come from measured baselines,** not guesses: browsing p95 under 50 ms, after measuring 1 ms.
- **Read performance results as comparisons,** not pass/fail. A green run with odd ratios is a finding.
- **CPU-heavy work stays off the event loop.** The unit test checks this in about a second on every CI run, without k6.
- **Not covered:** other CPU-heavy code added later (large JSON, regexes on user input) would not be caught by this test, only by the k6 run.
