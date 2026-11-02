# qa-practice-api: technical notes

How the API stores its data, how the tests prove it behaves the same on an in-memory store and on Postgres, and how it reports traces and metrics. The API itself, its routes and its test suites are described in the [README](README.md).

## Two stores, one shape

The routes import `src/db/store.ts`, which picks a store once at start-up:

| `DATABASE_URL` | Store | File |
|---|---|---|
| not set | In memory: a `Map` per table, empty after every restart | [`src/db/memory.ts`](src/db/memory.ts) |
| set | Postgres, through a `pg` connection pool | [`src/db/postgres.ts`](src/db/postgres.ts) |

Both implement the interfaces in [`src/db/types.ts`](src/db/types.ts): `insert`, `findById`, `findOne`, `findAll`, `update` and `delete` per table, plus `transaction(work)`. Every call returns a promise, because a database answers over a connection. The memory store answers at once but keeps the same shape, so the routes never know which one they have.

## Transactions and row locks

Once a read waits on the network, another request can read the same row in the gap. Three routes read, decide and write, so each runs in one transaction and locks what it reads:

| Route | Locks | Without the lock |
|---|---|---|
| `POST /orders` | each product, lowest id first, then the discount code | ten buyers all get the last item; a one-use code is used by seven |
| `PATCH /orders/:id/status` | the order, then its products | three cancels at once return the stock three times |
| `PATCH /discounts/:code` | the code | an order can take a use between the `max_uses` check and the write |

- **Lock order.** Products are locked in id order, so two orders for the same two products can't each hold one and wait for the other (a deadlock, which Postgres ends by failing one of them).
- **Reply after commit.** The reply is worked out inside the transaction and sent after `COMMIT` ([`src/middleware/handle.ts`](src/middleware/handle.ts)). Sent from inside, a client could read the old stock before the commit, or get a 201 for an order that was then rolled back.
- **Unique rules.** A repeated email or discount code is refused by the store itself (a `UNIQUE` index in Postgres, a check in memory) and answered as 409, so two sign-ups with one email at the same moment make one account.
- **In memory**, transactions queue and run one at a time. Each order also runs start to finish before the next request is read, so the order races can't happen there at all: the [concurrency tests](tests/concurrency.spec.ts) prove the locks only on Postgres.

## The Postgres schema

Created at start-up with `CREATE TABLE IF NOT EXISTS`, under an advisory lock so two servers starting together don't both create it.

- Money is `numeric`: exact decimals, read back as the same JavaScript number the API was sent.
- `stock`, quantities and `max_uses` are `numeric` too: the API accepts any whole number, and 1e19 or 1e21 don't fit a `bigint` (they were a 500 where the in-memory store said 201). `stock >= 0` is a `CHECK`, so even a buggy route can't store negative stock.
- An order's lines are rows in `order_items`, read back in the order they were sent.
- `expires_at` is text: the API returns it exactly as the admin sent it, time zone offset included.
- There are no foreign keys from orders to users or products: the API lets an admin delete either while old orders keep the id, as it always has.
- URL ids that don't fit the 32-bit id column are answered as not found without a query, and a page far past the end is empty without one (both were a 500).

## Running on Postgres

```bash
npm run test:postgres                                          # whole suite, 318 tests
node scripts/with-postgres.ts npx playwright test tests/concurrency.spec.ts
```

[`scripts/with-postgres.ts`](scripts/with-postgres.ts) starts `postgres:17-alpine` with Testcontainers, runs the command with `DATABASE_URL` pointing at it, and stops the container. It needs Docker running. In CI, the `qa-practice-api-postgres` job pulls the image first through `scripts/retry.sh` (Docker Hub answers 502 now and then), and [`scripts/postgres-ci.test.mjs`](../../scripts/postgres-ci.test.mjs) checks the pulled tag matches the one the launcher starts.

`playwright.config.ts` runs [`tests/postgres`](tests/postgres/postgres.spec.ts) only when `DATABASE_URL` is set, and never reuses a server already on the port then, since it could be an in-memory one.

## Traces and metrics

[`src/telemetry.ts`](src/telemetry.ts) sets up OpenTelemetry only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Without it, every tracing call does nothing, so `npm start` and the other packages that start this API (api-drift-checker, k6-performance, api-pytest, the ZAP job) run as before.

| Span | Made by | Holds |
|---|---|---|
| `POST /orders` (server) | [`src/middleware/tracing.ts`](src/middleware/tracing.ts), first middleware | method, path, route template, status code; parent from the caller's `traceparent` |
| `order.create` | [`src/routes/orders.ts`](src/routes/orders.ts) | order id, or a reject reason and an error status |
| `db.transaction` | [`src/db/traced.ts`](src/db/traced.ts), wrapping either store | `commit` or `rollback` |
| `db.lock` | the same, for every `{ lock: true }` read | table and row id (for `findOne`, the filter's column names only) |
| `BEGIN`, `SELECT`, `COMMIT`… | [`src/db/postgres.ts`](src/db/postgres.ts) | the SQL with `$1` placeholders, never the values |

| Metric | Kind | Attributes |
|---|---|---|
| `http.server.request.duration` | histogram, seconds | method, route template, status code |
| `orders.created` | counter | none |
| `orders.rejected` | counter | `qa.order.reject_reason`: `out_of_stock`, `product_not_found`, `discount_refused` or `invalid` |

**Why the spans are written by hand.** OpenTelemetry's auto-instrumentation patches Express and `pg` as they load. Under ES modules that needs a loader hook started before the app. The hand-written spans are the ones the tests check, and they say what this API does (an order, a lock), not only that a query ran.

**How the tests read them.** [`scripts/otlp-receiver.ts`](scripts/otlp-receiver.ts) takes OTLP/HTTP in JSON, the encoding the `exporter-*-otlp-http` packages send. It answers protobuf with a 415 instead of dropping it quietly. Playwright starts it as a second `webServer`, one per Stryker worker like the API. Spans are sent every 50 ms in the tests, and [`tests/telemetry.ts`](tests/telemetry.ts) polls for the trace until its server span has arrived. That span ends last, and spans are sent in the order they end, so everything inside it has arrived by then.

**Versions.** The 2.12 SDK line, with API 1.9 (`~1.9.1`: the 2.12 SDK refuses API 1.10). OpenTelemetry JS 3.0 came out on 2026-10-20 with renamed packages, and moving to it is a separate change.

Deliberate breaks, each put back alone:

| Break | What failed |
|---|---|
| The caller's `traceparent` ignored | OT-01, 02, 03, 05, 06: no server span under the test's trace id |
| The raw path recorded as the route | OT-03, OT-04: `/products/17` as a route, one metric series per product |
| A 4xx marks the server span failed | OT-02, OT-06 |
| The email recorded on the server span | OT-05 |
| `orders.created` not added | OT-04 |
| No `db.lock` span | OT-01 |
| Every reject reason `invalid` | OT-02, OT-04 |
| The lock span started after the locked read | PG-09, PG-10: no SELECT inside it, and it no longer covers the wait |
| The values written into the SQL text | PG-09 |
| The route not noted before an error leaves the router | OT-07: a 500 in the orders router named `GET /:id` |
| A hang-up counted as a reply | OT-08: an aborted request recorded as a 200 |

The first try at the email break changed nothing. It put the email on the span when the span starts, and that is before Express reads the body. Moved to the end of the request, it was caught.

## Deliberate breaks

Each was put in, shown to fail, and taken out:

| Break | What failed |
|---|---|
| No `FOR UPDATE` on locked reads | 6 of 8 concurrency tests on Postgres: 10 of 10 buyers got the last item, 15 of 15 got five in stock, 7 used a one-use code |
| No `UNIQUE` on `users.email` (Postgres) or the unique check (memory) | eight sign-ups with one email made eight accounts |
| No `BEGIN` in `transaction` | PG-05: the rolled-back product was still there |
| No id range check | PG-08: a 500 instead of a 404 |
| No page guard | PG-08: `?page=1000000000000000000` was a 500 instead of an empty page |
| `bigint` stock | PG-07: a product with stock 1e19 could not be created (500) |

## Known limits

- `GET /discounts` counts each code's uses with its own query: fine at this size, a grouped count if codes ever number in the thousands.
- An order for two products on Postgres runs 15 SQL statements (the trace shows them): each insert and update reads its row back. Fine at this size; `RETURNING *` would halve it.
- The counter tests check "at least": every test shares one API, so other tests' orders count too. An exact count would need a server of its own.
- POST /orders refused before its transaction (an empty `items`) is not in `orders.rejected`: the counter counts orders that reached the stock and code checks.
- The sign-in limiter and the JWT secret stay per process. With Postgres, accounts outlive a restart; set `JWT_SECRET` if their tokens should too.
- The admin account is created once. Restarting with a different `ADMIN_PASSWORD` keeps the old one on Postgres.
- [Burn-in](../../scripts/burn-in.mjs) runs a changed spec in `tests/postgres`, `tests/concurrency.spec.ts` or `tests/telemetry.spec.ts` three times on a Testcontainers Postgres; the race and trace tests also run three times in memory.
