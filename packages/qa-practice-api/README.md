# qa-practice-api

A purpose-built REST API for QA automation practice. Unlike third-party public APIs, this one is fully under your control — you can read the source, add edge cases, break things intentionally, and write tests against known behaviour.

**In plain English:** A small online-shop backend (users, products, orders) built for practising testing. Other packages in this repo test it, and they have found and fixed real bugs in it.

Built with Node.js and Express, in strict TypeScript that Node 24 runs directly (no build step). No database or external services required. Spins up in seconds.

## Stack

- **Runtime:** Node.js 24 + Express, TypeScript run by Node's type stripping
- **Data:** an in-memory store (`src/db/store.ts`): typed tables of users, products and orders, reset on every restart
- **Auth:** JWT (`jsonwebtoken`) + scrypt password hashing (Node's built-in `crypto.scrypt`, which runs off the event loop; see [k6-performance](../k6-performance) for why it replaced bcryptjs)
- **Tests:** Playwright API mode (no browser)
- **CI:** GitHub Actions, as one job in the monorepo pipeline

## Quick Start

```bash
npm install
npm start              # http://localhost:4000
npm run dev            # with --watch restart
```

## Running Tests

```bash
npm test               # full suite (starts server automatically)
npm run test:smoke     # @smoke tagged tests only
```

The data lives in memory, so each run starts with an empty store and no state leaks between runs.

123 tests: 38 written first, one or a few per route, and 85 in `tests/design` that come from a written [test strategy and test plan](../../docs/test-strategy/README.md). Those 85 were designed with named techniques: equivalence partitioning (20), boundary value analysis (22), decision tables (14) and state transitions (29). Each test's title starts with its case ID from the plan. They found 9 defects the first 38 had missed, all fixed below; run against the code from before the fixes, 41 of them fail.

`tests/password.spec.ts` holds two unit tests for password hashing. One checks that hashing eight passwords keeps the event loop free (0–11% busy measured, against 100% for hashing on the main thread), which guards the bug [k6 found](../../docs/rca/01-login-hashing-blocked-the-api.md) in about a second instead of a minute of load.

## API Reference

### Health
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/health` | No | Returns `{ status: "ok", timestamp }` |

### Auth
| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | No | Returns `{ user, token }` |
| POST | `/auth/login` | No | Returns `{ user, token }` |
| GET | `/auth/me` | Yes | Returns current user |

### Users
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/users` | Yes | Paginated. `?page=&limit=` |
| GET | `/users/:id` | Yes | |
| PUT | `/users/:id` | Yes | Own account only (or admin) |
| DELETE | `/users/:id` | Yes | Own account only (or admin) |

### Products
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/products` | No | Paginated. `?category=&page=&limit=` |
| GET | `/products/:id` | No | |
| POST | `/products` | Yes | |
| PUT | `/products/:id` | Yes | |
| DELETE | `/products/:id` | Yes | |

### Orders
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/orders` | Yes | Current user's orders only |
| GET | `/orders/:id` | Yes | Own order only |
| POST | `/orders` | Yes | `{ items: [{ product_id, quantity }] }` |
| PATCH | `/orders/:id/status` | Yes | `{ status: "pending\|processing\|shipped\|delivered\|cancelled" }`. Allowed moves: pending → processing or cancelled, processing → shipped or cancelled, shipped → delivered |

## Documented Edge Cases

These are intentional behaviours worth writing tests for:

| Scenario | Expected |
|---|---|
| `GET /users/999999` | `404 { error: "User 999999 not found" }` |
| `POST /auth/login` wrong password | `401` — does not distinguish wrong email vs wrong password (security best practice) |
| `POST /auth/register` duplicate email | `409 { error: "Email already in use" }` |
| `POST /products` with `price: -5` | `400 { error: "price must be a non-negative number" }` |
| `POST /products` with `price: "abc"` | `400`, same message. Found by [api-drift-checker](../api-drift-checker): this used to return `201` with `price: null`. |
| `POST /products` with `stock: -3` | `400 { error: "stock must be a non-negative whole number" }`. Also found by the drift checker; it used to return `201`. |
| `POST /orders` with quantity > stock | `400 { error: "Insufficient stock for product X (available: Y)" }` |
| `POST /orders` with two lines for the same product | Stock is checked against the combined quantity. It used to be checked line by line, so two lines of 6 against a stock of 10 were accepted and left stock at -2. |
| `PUT /products/:id` with `price: "abc"` or `stock: -7` | `400`, with the same messages as `POST`. Update used to skip these checks and store `price: null` and negative stock. |
| `POST /products` with `price: ""`, `true` or `"12.5"` | `400`. Prices, stock and quantities must be JSON numbers. `""` used to be stored as 0 and `true` as 1. |
| `POST /orders` with `quantity: 1.5` or `"2"` | `400`. A fraction used to be accepted (leaving stock at 8.5), and text quantities were joined, so `"2"` + `"3"` was checked as 23. |
| `POST /orders` with `items: [null]` | `400`. It used to crash the route with a 500 HTML page. |
| Any request with a malformed JSON body | `400 { error: "Request body is not valid JSON" }`. It used to be an HTML error page. |
| `PATCH /orders/:id/status` unknown value | `400 { error: "status must be one of: pending, processing, ..." }` |
| `PATCH /orders/:id/status` with a move the lifecycle doesn't allow | `409 { error: "Cannot change order status from delivered to pending" }`. Any move used to be accepted. |
| `PATCH /orders/:id/status` to `cancelled` | The order's stock goes back to its products. It used to stay taken. |
| `PUT /users/:id` with another account's email | `409 { error: "Email already in use" }`. It used to be accepted, leaving two accounts with one email. |
| `PUT /users/:id` for another user | `403 { error: "Cannot modify another user's account" }` |
| JWT after user deletion | Token stays cryptographically valid — route returns `404` on DB lookup. JWT invalidation requires a denylist; short expiry (`1h`) is the mitigation here. |
| `GET /products?page=0` | Page clamped to `1` — no error, consistent behaviour |
| `GET /products?limit=0` | Limit clamped to `1`, like `limit=-1`. It used to fall back to 10. |
| Admin-only paths (`PUT`/`DELETE /users/:id` for another account) | No route creates an admin, so these can't be tested from outside yet ([testability gap](../../docs/test-strategy/README.md#results)) |

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Server port |
| `JWT_SECRET` | `qa-practice-secret-change-in-prod` | Change this in any real deployment |
