# Game day: the line to the database was cut

| | |
|---|---|
| **Where** | [qa-practice-api](../../packages/qa-practice-api), the API on Postgres with Toxiproxy between them (`npm run game-day`) |
| **Found by** | A live incident drill on 2026-11-09 (A100): the incident commander cut the line without saying when, and the responder had only the pager, the traffic log, the API's own log and Toxiproxy |
| **Impact** | Every request that needed the database failed with a 503 for 146.9 seconds (118 of 2,278 one-second checks). Nothing crashed, no order was lost or doubled, and the API recovered 0.8 seconds after the line came back without a restart. The drill found three gaps (below) |
| **Fixed in** | A100 (S2b), the log fix and its test in the same pull request. The runbook is in [Prevention](#prevention) |

This was a drill, not a real outage, and the page is blameless: it asks what the system and the process made easy or hard, not who did what.

## Symptom

Everything below is UTC, from `traffic.log`, `pager.log` and the commander's `ground-truth.log` (the responder did not read that one until this page).

| Time | What happened |
|---|---|
| 13:43:44.9 | The commander cuts the line (Toxiproxy proxy disabled) |
| 13:43:45.3 | First failed check: `/health/ready`, `/products` and the order all return `503` |
| 13:43:47.7 | The pager fires: three readiness checks in a row failed (2.9 s after the cut) |
| 13:44:05 | The responder looks: `/health` is `200`, `/health/ready` is `503` with `Retry-After: 2`, the API log is full of `database unavailable (connect)` |
| 13:44:14 | The responder has the cause: Postgres is accepting connections (`pg_isready`), the proxy `game-day` has `enabled: false`. The fix is to enable it, and the responder asks the commander for the go |
| 13:46:10.9 | The commander restores the line |
| 13:46:11.7 | First good check, 0.8 s later. Orders work again. No restart |
| 13:46:13.8 | The pager resolves (three good checks in a row) |

Of the 146.9 seconds, 2.9 were detection, 26.5 from the page to a diagnosis and an ask, and **116.5 (79%) were waiting for the go**.

## How it was found

The drill was built so nobody knew the answer in advance. `scripts/game-day.ts` starts Postgres, Toxiproxy, the API and steady traffic (a readiness check, a read and an order every second) and keeps a timeline. The responder used the same steps an on-call person would: the process (`/health`), the dependency (`/health/ready`), the database itself, then the line in between. The data was checked afterwards: no order was created inside the outage (the last one before it at 13:43:43.98, the first after at 13:46:11.71), and every `201` in the traffic log matches an order in the database, apart from the one check in flight when it was counted.

Dead end: the first look at the API log gave no way to say when the errors started. The lines have no time in them, so they could not be lined up with the pager or the cut.

## Root cause

There was no outage cause to fix: the line was cut on purpose and the API did what Day 51 built it to do (clean 503s, no crash, recovery by itself). The drill found three weaknesses in how the incident could be worked:

1. **The API log could not be read as a timeline.** Each failed request wrote `database unavailable (connect): Connection terminated unexpectedly` and nothing else: 355 identical lines, no time, no method, no path. The pool's own error lines had no time either.
2. **Most of the outage was waiting for permission.** Re-enabling the line was safe and reversible, but nobody had said the responder could do it, so 116.5 seconds went on asking.
3. **The responder's notes and the harness's logs used different clocks.** The harness logs UTC; notes taken with the local clock were five hours off, so building the timeline above meant converting by hand.

A fourth point was noted and left open: `/health/ready` says `Database unavailable` but not whether the database is down or the line to it is, so finding out took three separate checks.

## Fix

- **Log lines with a time and a request** ([src/log.ts](../../packages/qa-practice-api/src/log.ts)): the database-unavailable line is now `2026-11-09T13:43:50.123Z GET /products database unavailable (connect): ...`, and the pool's own errors carry the time.
- **`npm run game-day -- note "text"`** writes the responder's notes to `responder.log` with the harness's clock.
- **A runbook** with a first move the responder may make without asking (see Prevention).
- **Rejected:** putting the cause in the `/health/ready` reply. It is a public endpoint, and saying which dependency is down is more than a load balancer needs.

## Regression tests

- [`packages/qa-practice-api/tests/postgres/resilience.spec.ts`](../../packages/qa-practice-api/tests/postgres/resilience.spec.ts) › `RS-10 a request that fails because the database is down leaves a log line with the time, the method and the path`
- [`packages/qa-practice-api/tests/game-day.spec.ts`](../../packages/qa-practice-api/tests/game-day.spec.ts) › `GD-01 one or two failed checks page nobody, the third in a row does, and only once`
- [`packages/qa-practice-api/tests/game-day.spec.ts`](../../packages/qa-practice-api/tests/game-day.spec.ts) › `GD-03 the page clears after three good answers in a row, and a bad one in between starts that count again`
- [`packages/qa-practice-api/tests/game-day.spec.ts`](../../packages/qa-practice-api/tests/game-day.spec.ts) › `GD-05 the game day starts the same Postgres and Toxiproxy images as the tests`

Each was put back once. With the old `console.error` in place RS-10 fails (the log has no timestamped line within 5 s). Setting the page threshold to 1 fails GD-01, GD-02 and GD-04; removing the reset of the good count fails GD-03; removing the reset of the bad count fails GD-02 and GD-04; a different Toxiproxy tag in the game day fails GD-05. RS-10 passed 8 of 8 on repeat, and all ten resilience tests pass.

## Prevention

**Runbook: database unreachable.** Work down the list; the first four only read.

1. `/health` answers? Then the process is up and the problem is behind it.
2. `/health/ready` is `503`? Then the API cannot reach the database.
3. Is Postgres itself up? (`pg_isready` on the database host.)
4. Is the line between them up? (In the drill, the Toxiproxy proxy: `enabled`, and any toxics.)
5. **Pre-approved:** if the line was disabled and nothing else is wrong, enable it. It is reversible and changes no data. Tell the incident commander what you did, do not ask first.
6. After it is back, check readiness and an order, and compare orders with what clients were told (a `503` that says "may have been saved" is the only kind that needs a look).

Still not covered: only one fault (a full cut) was drilled live; slow-line and reset faults are covered by the Day 51 tests but have not been run as a game day. The API's log still has no request id, so lines from two requests at the same moment cannot be told apart. And the readiness reply still does not say which side of the line failed.
