# api-drift-checker

Checks that a live API still matches its written contract (an OpenAPI spec): the right status codes, the right fields, the right types, and nothing extra. It walks through a realistic scenario (sign up, add a product, place an order, update it) and checks every response.

**In plain English:** API documentation and the API itself drift apart over time. A field gets renamed, a number comes back as text, or an internal field like a password hash starts showing up. The apps that depend on the API break, often quietly. This tool finds the gap before they do.

---

## It Found Two Real Bugs

The first run against [qa-practice-api](../qa-practice-api) reported drift on 2 of 20 responses:

```
DRIFT POST   /products              201  create a product with a non-numeric price
        unexpected-status: expected 400, got 201
        type: $.price expected number, got null
DRIFT POST   /products              201  create a product with negative stock
        unexpected-status: expected 400, got 201
        range: $.stock -3 is below the minimum 0

18/20 responses match the spec, 2 drifted
Documented operations never called: none
```

1. **A text price was accepted.** `price: "abc"` passed the `price < 0` check (`"abc" < 0` is false), `parseFloat` turned it into `NaN`, and JSON sent `NaN` back as `null`. The product was saved with no price.
2. **Negative stock was accepted.** Only the price was range-checked.

Both are fixed in `qa-practice-api` in the same change, with two new API tests. The live check now passes 20 of 20.

---

## What It Checks

| Drift | Example |
|---|---|
| `unexpected-status` | The scenario expected `400`, the API returned `201` |
| `undocumented-status` | The API returned `500`, which the spec doesn't list for that endpoint |
| `undocumented-endpoint` | A call to a path that isn't in the spec |
| `missing` | A required field isn't in the response |
| `extra` | A field the spec doesn't allow, such as a leaked `password` |
| `type` | `"29.99"` (text) where a number is documented, or `null` |
| `enum` | `role: "superuser"` when only `user` and `admin` are allowed |
| `range` | `stock: -3` when the minimum is 0 |
| `format` | `created_at: "yesterday"` where a date-time is documented |

It also lists any documented operation the scenario never called, so gaps in coverage show up.

---

## Usage

```bash
npm ci --prefix ../qa-practice-api   # the API's own dependencies
npm run check:live                   # start the API, run the scenario, stop it
node src/live.js --url http://localhost:4000   # an API that's already running
```

Exit code 1 on any drift, so it can run as a contract gate in CI. The CI job for this package does exactly that against the real API.

---

## How It's Built

- `spec/qa-practice-api.openapi.json`: the contract, written from the API's routes. Response objects use `additionalProperties: false`, so leaked fields are caught.
- `src/schema.js`: a small validator for the OpenAPI features used here (types, required, enums, minimums, date-times, `$ref`, nullable). It reports every problem with a JSON path, not just the first.
- `src/runner.js`: runs scenario steps, saves values like tokens and ids for later steps, checks each response.
- `scenarios/qa-practice-api.js`: 20 steps, including two that send invalid data on purpose.

---

## Tests

```bash
npm test   # 16 tests
```

The runner tests use a fake API with one switch per kind of drift (leaked password, price as text, missing field, unknown enum value, a 500 where a 404 is documented) and check that each is caught at the right step.

**Observation, not drift:** `GET /orders` returns a plain array while `/products` and `/users` return a page object. It matches the spec, but the inconsistency is worth raising with the API's owners.
