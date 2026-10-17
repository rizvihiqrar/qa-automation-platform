# qa-practice-api

A purpose-built REST API for QA automation practice. Unlike third-party public APIs, this one is fully under your control — you can read the source, add edge cases, break things intentionally, and write tests against known behaviour.

**In plain English:** A small online-shop backend (users, products, orders) built for practising testing. Other packages in this repo test it, and they have found and fixed real bugs in it.

Built with Node.js and Express, in strict TypeScript that Node 24 runs directly (no build step). No database or external services required. Spins up in seconds.

## Stack

- **Runtime:** Node.js 24 + Express, TypeScript run by Node's type stripping
- **Data:** an in-memory store (`src/db/store.ts`): typed tables of users, products and orders, reset on every restart
- **Auth:** JWT (`jsonwebtoken`, HS256, checked against the account on every request) + scrypt password hashing (Node's built-in `crypto.scrypt`, which runs off the event loop; see [k6-performance](../k6-performance) for why it replaced bcryptjs)
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

The data lives in memory, so each run starts with an empty store and no state leaks between runs. The test server is seeded with an admin (`ADMIN_EMAIL` and `ADMIN_PASSWORD`, set in `playwright.config.ts`), and `tests/global-setup.ts` signs it in once for every test that needs it.

165 tests: 38 written first, one or a few per route; 119 in `tests/design` that come from a written [test strategy and test plan](../../docs/test-strategy/README.md); 4 header checks and 4 unit tests of the sign-in limiter. The 119 were designed with named techniques: equivalence partitioning (20), boundary value analysis (25), decision tables (23), state transitions (29) and an access-control matrix (22). Each test's title starts with its case ID from the plan. The first 85 found 9 defects the first 38 had missed; the access-control and sign-in cases found 8 security defects ([below](#security)). All are fixed.

`tests/rate-limit.spec.ts` tests the sign-in limiter's window with a fake clock, which the API tests can't wait 15 minutes for. `tests/password.spec.ts` holds two unit tests for password hashing. One checks that hashing eight passwords keeps the event loop free (0–11% busy measured, against 100% for hashing on the main thread), which guards the bug [k6 found](../../docs/rca/01-login-hashing-blocked-the-api.md) in about a second instead of a minute of load.

## API Reference

### Health
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/health` | No | Returns `{ status: "ok", timestamp }` |

### Auth
| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | No | Returns `{ user, token }` |
| POST | `/auth/login` | No | Returns `{ user, token }`. 5 attempts per email and client in 15 minutes without a success, then `429` with `Retry-After` |
| GET | `/auth/me` | Yes | Returns current user |

### Users
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/users` | Admin | Paginated. `?page=&limit=` |
| GET | `/users/:id` | Yes | Own account only (or admin) |
| PUT | `/users/:id` | Yes | Own account only (or admin) |
| DELETE | `/users/:id` | Yes | Own account only (or admin) |

### Products
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/products` | No | Paginated. `?category=&page=&limit=` |
| GET | `/products/:id` | No | |
| POST | `/products` | Admin | |
| PUT | `/products/:id` | Admin | |
| DELETE | `/products/:id` | Admin | |

### Orders
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/orders` | Yes | Current user's orders (admin: all) |
| GET | `/orders/:id` | Yes | Own order only (admin: any); another customer's is `404` |
| POST | `/orders` | Yes | `{ items: [{ product_id, quantity }] }` |
| PATCH | `/orders/:id/status` | Yes | `{ status: "pending\|processing\|shipped\|delivered\|cancelled" }`. Allowed moves: pending → processing or cancelled, processing → shipped or cancelled, shipped → delivered. A customer may only cancel their own order; every other move is the admin's |

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
| JWT after user deletion | `401 { error: "Account no longer exists" }` on every route. Every request now looks the account up, so a deleted account's token stops working at once. It used to keep working for the rest of its hour. |
| `GET /products?page=0` | Page clamped to `1` — no error, consistent behaviour |
| `GET /products?limit=0` | Limit clamped to `1`, like `limit=-1`. It used to fall back to 10. |
| A customer on an admin route | `403 { error: "Admin role required" }`. Product changes and the user list used to be open to any signed-in customer. |
| `role: "admin"` sent at sign-up or on `PUT /users/:id` | Ignored; the account stays a customer. No route makes an admin: start the server with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. |

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Server port |
| `JWT_SECRET` | random, per start | Set it to keep tokens valid across restarts (pointless here, since the data doesn't survive one). It used to default to a fixed string written in this file, so anyone could sign a token |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | none | Both set: the server creates this admin at start-up. Neither set: there is no admin |

## Security

Who may call what is tested case by case in [tests/design/access-control.spec.ts](tests/design/access-control.spec.ts): every protected action against no token, a customer on their own data, a customer on someone else's, the admin, and a deleted account's token. The matrix and the reasons are in the [test plan](../../docs/test-strategy/test-plan.md#access-control). Writing it found 8 defects, listed with the cases that catch them in the [strategy's results](../../docs/test-strategy/README.md#day-36-security); each fix was checked by putting the bug back.

### Security scan

The `zap-baseline` job in CI scans this API with [OWASP ZAP](https://www.zaproxy.org/) 2.17.0, running passive rules only. ZAP's plain baseline scan crawls links from the home page, and a JSON API has none, so the job runs ZAP's API scan on the [OpenAPI spec](../api-drift-checker/spec/qa-practice-api.openapi.json) with `-S` (safe mode: the passive baseline rules, no active attacks). Every documented operation is requested once, signed in as the seeded admin, and ZAP's rules check each response. The report is published with the [other test reports](https://rizvihiqrar.github.io/qa-automation-platform/reports/).

How a finding is triaged, in [zap/rules.tsv](zap/rules.tsv):

- **Fixed:** set to `FAIL`, so the job fails if it ever comes back.
- **Accepted** or **False positive:** set to `IGNORE`, with the reason below.
- **Not triaged:** anything new stays a `WARN`, which also fails the job. Someone has to decide what it is before the change can merge.

| Rule | Alert | Risk | Where | Decision | Reason |
|---|---|---|---|---|---|
| 10021 | X-Content-Type-Options Header Missing | Low | 5 responses, all those that came back 200 | Fixed | Without `nosniff`, a browser may read a JSON body as HTML or script if a value in it looks like markup. Every response now sends it, including errors from the JSON error handler ([headers.spec.ts](tests/headers.spec.ts)) |
| 90004 | Insufficient Site Isolation Against Spectre Vulnerability | Low | the same 5 responses | Fixed | No `Cross-Origin-Resource-Policy`, so another site could load these responses into its own page. Now `same-origin`: the API is only called from code, never embedded |
| 10116 | ZAP is Out of Date | Low | the scanner | Accepted | The first run pinned 2.16.1, and ZAP said 2.17.0 was out. Updated. The version stays pinned, so a ZAP release can't change the results without a commit; the rule is ignored so a new release doesn't fail unrelated changes. Updating is a deliberate change |
| 10049 | Non-Storable Content | Informational | signed-in responses | False positive | ZAP points out that responses can't be cached. That is the right behaviour for per-user data such as orders and accounts |
| 100000 | A Client Error response code was returned by the server | Informational | 8 operations, first run | False positive | On the first run these were the API correctly refusing ZAP's requests (empty bodies, `{id}` left in the URL; see below). With request examples in the spec it no longer fires, but a refused request is still the expected answer, not a defect |
| 10111 | Authentication Request Identified | Informational | `POST /auth/login` | False positive | ZAP recognising the sign-in request. Nothing to fix |
| 10112 | Session Management Response Identified | Informational | sign-up and sign-in | False positive | ZAP recognising the token in the response. Nothing to fix |

**What the first scan showed about the scan.** ZAP reached only 5 of the 13 operations with a real request. The spec described responses but not request bodies or path parameters, so ZAP sent empty bodies and requested `/products/{id}` with the braces in the URL; those 8 operations only ever answered 400 or 404, and the scan was quietly checking error pages. The spec now has request bodies and parameters with examples, and on the second run the client-error alert was gone: all 13 operations were answered normally.

**What the scan doesn't cover.** It requests each operation once, with one set of example values, and judges the responses: headers, cookies, leaked data. It doesn't attack anything. ZAP's log lists active rules such as SQL Injection as `PASS` even in safe mode, but they never ran (the whole scan takes about 3 seconds). It also can't see authorization: a customer reading another customer's order looks like any other 404 to it. That is what the access-control cases are for.
