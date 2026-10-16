# qa-practice-api

A purpose-built REST API for QA automation practice. Unlike third-party public APIs, this one is fully under your control — you can read the source, add edge cases, break things intentionally, and write tests against known behaviour.

Built with Node.js, Express, and SQLite. No external services required. Spins up in seconds.

## Stack

- **Runtime:** Node.js 20 + Express
- **Database:** SQLite via `better-sqlite3` (in-memory for tests, file-based for dev)
- **Auth:** JWT (`jsonwebtoken`) + bcrypt password hashing
- **Tests:** Playwright API mode (no browser)
- **CI:** GitHub Actions — smoke gates regression

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

Tests use an in-memory SQLite database — each run starts clean, no state leaks between runs.

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
| `PATCH /orders/:id/status` unknown value | `400 { error: "status must be one of: pending, processing, ..." }` |
| `PUT /users/:id` for another user | `403 { error: "Cannot modify another user's account" }` |
| JWT after user deletion | Token stays cryptographically valid — route returns `404` on DB lookup. JWT invalidation requires a denylist; short expiry (`1h`) is the mitigation here. |
| `GET /products?page=0` | Page clamped to `1` — no error, consistent behaviour |

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Server port |
| `JWT_SECRET` | `qa-practice-secret-change-in-prod` | Change this in any real deployment |
| `DB_FILE` | `:memory:` (test) / `data/app.db` (dev) | Set to `:memory:` for isolated test runs |
| `NODE_ENV` | — | Set to `test` to use in-memory DB automatically |
