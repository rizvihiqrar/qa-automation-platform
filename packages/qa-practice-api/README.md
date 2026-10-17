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
| PATCH | `/orders/:id/status` | Yes | `{ status: "pending\|processing\|shipped\|delivered\|cancelled" }` |

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
| `PATCH /orders/:id/status` unknown value | `400 { error: "status must be one of: pending, processing, ..." }` |
| `PUT /users/:id` for another user | `403 { error: "Cannot modify another user's account" }` |
| JWT after user deletion | Token stays cryptographically valid — route returns `404` on DB lookup. JWT invalidation requires a denylist; short expiry (`1h`) is the mitigation here. |
| `GET /products?page=0` | Page clamped to `1` — no error, consistent behaviour |

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Server port |
| `JWT_SECRET` | `qa-practice-secret-change-in-prod` | Change this in any real deployment |
