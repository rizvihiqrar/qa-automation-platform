# The prompt

Given to the AI as one message. The spec section is [spec.md](../spec.md) pasted word for word (a root test checks that the copy below still matches).

---

You are adding a feature to `packages/qa-practice-api`, an Express 4 API in strict TypeScript that Node 24 runs directly (no build step). Read the existing code first: `src/app.ts`, `src/db/store.ts` (an in-memory store), `src/middleware/auth.ts` (`requireAuth`, `requireAdmin`, `currentUser`, `isAdmin`) and `src/routes/orders.ts`, and follow their style.

Implement the spec below. Change whatever files you need, including the OpenAPI document it names. Do not write tests and do not change existing tests: the feature will be reviewed and tested separately. The existing tests must keep passing and `npm run typecheck` at the repository root must stay clean.

<!-- spec:start -->
## Discount codes for qa-practice-api

Admins create discount codes. Customers enter one when they place an order and get money off. All amounts are in dollars, with cents.

### Endpoints

| Method | Path | Who | Does |
|---|---|---|---|
| POST | `/discounts` | admin | Create a code (201) |
| GET | `/discounts` | admin | List every code |
| GET | `/discounts/{code}` | admin | One code; `{code}` ignores case |
| PATCH | `/discounts/{code}` | admin | Change `active`, `expires_at` or `max_uses` |
| POST | `/orders` | signed in | Now also takes an optional `discount_code` |

### Codes

- **DC-R01** `code` is a string. After trimming surrounding spaces it must be 3 to 20 characters, each a letter A–Z (either case), a digit or a hyphen. It is stored and returned in upper case. Otherwise 400.
- **DC-R02** Codes are unique ignoring case: creating `summer` when `SUMMER` exists is a 409.
- **DC-R03** `type` is `"percent"` or `"fixed"`. Otherwise 400.
- **DC-R04** `value`: for `percent`, a whole number from 1 to 100; for `fixed`, a number above 0 with at most two decimal places. JSON numbers only: `"10"` is refused. Otherwise 400.
- **DC-R05** `expires_at` is optional: an ISO 8601 date-time with a time zone (for example `2026-12-31T23:59:59Z`), or `null` for never. When given it must be in the future, on create and on change, otherwise 400. A code can be used while the current time is before `expires_at`; at or after it, the code has expired.
- **DC-R06** `max_uses` is optional: a whole number of at least 1, or `null` for no limit (the default). Otherwise 400.
- **DC-R07** `min_subtotal` is optional: a number of at least 0 with at most two decimal places. Default 0. Otherwise 400.
- **DC-R08** `active` is optional, `true` or `false`, default `true`. Otherwise 400.
- **DC-R09** A code is returned as `{ code, type, value, expires_at, max_uses, min_subtotal, active, uses, created_at }`. `uses` is the number of orders currently counting against the code (see DC-R21 to DC-R23).
- **DC-R10** Every `/discounts` endpoint needs an admin: no token or a bad token is a 401, a customer is a 403. An unknown code on GET or PATCH is a 404.
- **DC-R11** PATCH accepts only `active`, `expires_at` and `max_uses`, validated as on create. Any other field in the body is a 400 (placed orders refer to the code as it was). Setting `max_uses` below the current `uses` is a 409.
- **DC-R12** Codes cannot be deleted. Turn one off instead.

### Using a code on an order

- **DC-R13** `POST /orders` takes an optional `discount_code`. Omitted or `null` means no code. Any other non-string, or a string that is empty after trimming, is a 400. Otherwise the code is looked up after trimming, ignoring case.
- **DC-R14** One code per order.
- **DC-R15** The existing item and stock checks run first and keep their responses. Then the code is checked, in this order, and the first failure refuses the order with 422 and `{ error }`:
  1. no such code, or the code is turned off: `Discount code is not valid` (the same message for both, so codes can't be probed);
  2. expired: `Discount code has expired`;
  3. `uses` has reached `max_uses`: `Discount code has reached its usage limit`;
  4. this customer already has an order counting against the code: `You have already used this discount code`;
  5. subtotal below `min_subtotal`: `Order subtotal must be at least 50.00 to use this code` (with the code's minimum, two decimals).

  A refused order changes nothing: no order, no stock taken, no use counted.
- **DC-R16** The subtotal is the sum of price × quantity before any discount. The minimum is met when the subtotal is equal to or above `min_subtotal`.
- **DC-R17** The discount for `percent` is subtotal × value / 100, rounded to the nearest cent, with half a cent rounding up. For `fixed` it is the value. Either way it is capped at the subtotal, so it never makes the total negative.
- **DC-R18** The total is the subtotal minus the discount. Work amounts out in whole cents, not floating-point dollars, so no amount picks up float noise (in JavaScript, `Math.round(1.005 * 100) / 100` is 1, not 1.01).
- **DC-R19** An order gains `subtotal`, `discount_code` (upper case, or `null`) and `discount` (0 with no code). `total` keeps its meaning: the amount to pay. An order without a code has `subtotal` equal to `total`.
- **DC-R20** An order keeps the discount it was placed with. Turning the code off or changing it later does not change placed orders.

### Uses

- **DC-R21** A use counts when an order with the code is placed. `uses` never goes above `max_uses`.
- **DC-R22** Each customer may use a code once: they may not place an order with a code while they have another order counting against it.
- **DC-R23** Cancelling an order gives its use back: the code's `uses` drops by 1 and the customer may use the code again.
- **DC-R24** Admins placing orders follow the same rules as customers.

### Documentation

- **DC-R25** The OpenAPI document (`packages/api-drift-checker/spec/qa-practice-api.openapi.json`) describes the new endpoints, `discount_code`, and the new order fields.

### Worked examples

| Subtotal | Code | Discount | Total |
|---:|---|---:|---:|
| 59.98 | 10% | 6.00 | 53.98 |
| 10.05 | 10% | 1.01 | 9.04 |
| 20.00 | 25.00 fixed | 20.00 | 0.00 |
| 50.00 | 10.00 fixed, minimum 50.00 | 10.00 | 40.00 |
| 49.99 | 10.00 fixed, minimum 50.00 | refused, 422 | |
| 0.30 (3 × 0.10) | 100% | 0.30 | 0.00 |

### Out of scope

- Checking a code before placing an order.
- Codes limited to some products, categories or customers.
<!-- spec:end -->
