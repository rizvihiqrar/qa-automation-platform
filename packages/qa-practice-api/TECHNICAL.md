# qa-practice-api: technical notes

How the API stores its data, and how the tests prove it behaves the same on an in-memory store and on Postgres. The API itself, its routes and its test suites are described in the [README](README.md).

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
npm run test:postgres                                          # whole suite, 308 tests
node scripts/with-postgres.ts npx playwright test tests/concurrency.spec.ts
```

[`scripts/with-postgres.ts`](scripts/with-postgres.ts) starts `postgres:17-alpine` with Testcontainers, runs the command with `DATABASE_URL` pointing at it, and stops the container. It needs Docker running. In CI, the `qa-practice-api-postgres` job pulls the image first through `scripts/retry.sh` (Docker Hub answers 502 now and then), and [`scripts/postgres-ci.test.mjs`](../../scripts/postgres-ci.test.mjs) checks the pulled tag matches the one the launcher starts.

`playwright.config.ts` runs [`tests/postgres`](tests/postgres/postgres.spec.ts) only when `DATABASE_URL` is set, and never reuses a server already on the port then, since it could be an in-memory one.

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
- The sign-in limiter and the JWT secret stay per process. With Postgres, accounts outlive a restart; set `JWT_SECRET` if their tokens should too.
- The admin account is created once. Restarting with a different `ADMIN_PASSWORD` keeps the old one on Postgres.
- [Burn-in](../../scripts/burn-in.mjs) runs a changed spec in `tests/postgres`, or `tests/concurrency.spec.ts`, three times on a Testcontainers Postgres; the race tests also run three times in memory.
