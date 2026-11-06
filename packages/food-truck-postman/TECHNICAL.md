# food-truck-postman: technical guide

[← Back to overview](README.md)

**Contents:** [Features](#features) · [Configuration](#configuration) · [CI integration](#ci-integration) · [FAQ](#faq) · [Troubleshooting](#troubleshooting) · [Development](#development) · [License](#license)

## Features

### The API

| Route | Who | What it does |
|---|---|---|
| `GET /health` | anyone | `{ "status": "ok" }` |
| `GET /menu` | anyone | Items with `price_cents` and `sold_out` |
| `PATCH /menu/:id` | staff | Turns `sold_out` on or off |
| `POST /auth/login` | anyone | Returns a token and a role |
| `POST /orders` | signed in | Places an order: `items`, `fulfilment` (`pickup` or `delivery`), `address` for a delivery |
| `GET /orders/:id` | owner, staff | Reads an order. Another customer gets `404`, so an id reveals nothing |
| `POST /orders/:id/pay` | owner, staff | Pays with `card_number`. Needs an `Idempotency-Key` header |
| `PATCH /orders/:id/status` | staff | Kitchen and driver steps |
| `POST /orders/:id/cancel` | owner, staff | Cancels before preparing. A paid order gets back whatever hasn't been refunded yet |
| `POST /orders/:id/refund` | staff | Refunds `amount_cents`, or everything left if it is left out |
| `GET /orders/:id/tracking` | owner, staff | ETA and driver step, once the order is out for delivery |

Every response is JSON with an `X-Request-Id` header, and every refusal is `{ error, code }`.

### Money

Whole cents everywhere. HST is 13%, worked out **once on the order** (food plus delivery fee) and rounded half up with integers only:

```ts
// src/money.ts
export const taxOn = (cents: number): number => Math.floor((cents * TAX_PERCENT + 50) / 100);
```

Three sweet teas at 250 cents make 750, tax 97.5, so 98. Rounded per item, each tea's tax would be 32.5, so 33, and the order would pay 99. The delivery fee is a flat 499 cents and is taxed with the food. This ignores Ontario's real exemptions for some food and drink: it is a rule to test, not tax advice.

### Order status

```text
placed ─► paid ─► preparing ─► ready ─► out_for_delivery ─► delivered   (delivery)
  │        │                     └────► picked_up                       (pickup)
  └────────┴─► cancelled
```

A bad move is `409 invalid_transition` with the allowed next states in `allowed`. `paid` is reached only by paying and `cancelled` only by cancelling, so the status route refuses those two with `400 invalid_status`.

### Test cards

| Card | What the provider does | Reply | Order |
|---|---|---|---|
| `4242424242424242` | Approves | `200` | paid |
| `4000000000000002` | Declines | `402 card_declined` | stays placed |
| `4000000000000119` | Takes the money, then never answers | `504 provider_timeout` | stays placed |
| `4000000000000259` | Charges twice | `200`, `duplicates_voided: 1` | paid, one charge kept |
| Any other 16 digits | Declines | `402 card_declined` | stays placed |

The timeout card is the interesting one. The money moved but the reply never came, so the API can't know how it ended. A timeout is not remembered against the key, and the retry reaches the provider again. The provider finds the charge it already made for that order and card and returns it, so the retry ends in `200` with one charge. A different card means the first attempt was given up: its charge is voided, and the new card decides. A cancel in that state voids the waiting charge too.

A refund, and a cancel of a paid order, reach the provider as well, so its books agree with the order.

### Idempotency

`Idempotency-Key` is required on `POST /orders/:id/pay`:

| Request | Result |
|---|---|
| No key | `400 idempotency_key_required` |
| Same key, same order and card | The first result again, with `Idempotent-Replayed: true`. A replayed decline never reaches the provider |
| Same key, different order or card | `422 idempotency_key_reused` |
| Same key, sent five times while the charge is running | One charge, five equal replies: the attempt is remembered from the moment it starts |
| New key while a payment is running | `409 payment_in_progress` |
| New key on a paid order | `409 invalid_transition` |

Keys belong to the person who sent them, so two customers can use the same one. Only a declined or approved result is remembered.

### The collection

| Folder | Requests | What it covers |
|---|---:|---|
| 01 Smoke | 5 | Is it up, and does the main path answer? |
| 02 Menu | 9 | Sold-out flag, set by staff, and put back afterwards |
| 03 Orders (validation) | 9 | Money rules and malformed requests |
| 04 Payments (test cards) | 20 | Each card, replays, a retry after a timeout, the double charge |
| 05 Order flow | 33 | The chained story, the pickup path, cancelling, refunds |
| 06 Access | 17 | No token, wrong role, somebody else's order |
| 07 Data-driven | 6 | One request per data file, one iteration per row |

Each folder signs in for itself, so any folder can run alone. Three tests at collection level run on every response: it is JSON, it has a request id, and it finishes under `maxResponseMs`.

The JSON file is the source: edit it in Postman and export it, or edit it by hand. Scripts live in the file, so a reader who imports it sees everything.

### Variables and tokens

| Where | What | Why |
|---|---|---|
| Environment | `baseUrl` only | A file you could safely send to anyone |
| Collection variables, saved | Demo logins, test cards, schemas, `maxResponseMs` | They ship with the collection. The accounts exist only in this demo's memory |
| Collection variables, set during a run | Tokens, order ids, keys | Set by the login and create requests, and never saved |

`test/collection.test.ts` fails if a token variable holds a value, if an environment holds anything but `baseUrl`, or if a file has a token shape in it. `npm run report` also fails if a report holds a 64-hex token. The reports leave out the `Authorization` header and the login reply bodies, the lesson of [the token write-up](../../docs/rca/05-tokens-in-published-reports.md).

### Why node tests as well

Postman sees only what the API says. If the API voids nothing when the provider charges twice, it can still answer `200` with the right numbers. `test/payments.test.ts` reads the mock provider's own list of charges, and covers the things one request at a time can't show. A gate in the mock provider holds a charge open, so the overlap is certain and not a matter of timing: five requests with one key, a second payment with a new key, a cancel during a running payment.

`npm run breaks` proves the point: the "second charge kept" bug passes every Postman test and fails one node test.

### Planted bugs

`scripts/breaks.ts` copies the source to a temporary folder, changes one line, and runs the suite against the copy. The real code has no test switches. If a line to change has gone, the script fails, so a refactor can't quietly turn a planted bug into nothing. Only the named test counts. If the planted API stops answering, or more than a few node tests fail, that is a miss: a broken suite is not a caught bug.

| Planted bug | Caught by |
|---|---|
| Tax rounded per item | `Tax is rounded once per order, not per item` |
| A declined card marks the order paid | `Declined order is still unpaid` |
| The same key is treated as a new payment | `Same key and body returns the first result` |
| A refund over the paid total is accepted | `Refund more than is left` |
| A customer reads another customer's order | `Another customer cannot read it` |
| Cancel allowed after preparing | `Cancel after preparing has started` |
| A sold-out item can be ordered | `Order a sold-out item` |
| An order shows an unknown field | `Create an order` (the schema check) |
| The second charge is kept | Node test: `the provider charges twice` |

### What this leaves out

- Refunds have no idempotency key, so a staff member who double-clicks a partial refund refunds twice, up to the paid total.
- Passwords are plain text in the source and tokens never expire: these are demo accounts in memory, so a restart clears everything.
- Tracking moves one step per read, so a test gets the same answer every time. A real driver moves with the clock.

## Configuration

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `4400` | The API's port. `0` picks a free one |
| `maxResponseMs` (collection variable) | `1000` | The limit in the collection-level time check |
| `CI` | not set | Set: Newman uses `ci.postman_environment.json`, otherwise `local`. Either way `npm test` replaces the base URL with the free port it chose |

| Script | What it does |
|---|---|
| `npm test` | Every folder and both data files, then stops the API |
| `npm run smoke` | `01 Smoke` |
| `npm run flow` | `05 Order flow` |
| `npm run data` | The two data-file runs |
| `npm run report` | Like `npm test`, plus HTML and JUnit files in `reports/` |
| `npm run burn-in` | `npm test` five times, each on a fresh API |
| `npm run breaks` | Each planted bug, which must go red |
| `npm run test:unit` | The node tests and the guards on the Postman files |
| `npm start` | The API alone, for the Postman app |

A data file applies to a whole Newman run, which is why a full run is three passes.

The same run by hand, with Newman's own command line:

```bash
npm start &
npx newman run postman/food-truck.postman_collection.json \
  -e postman/local.postman_environment.json \
  --folder "Orders from CSV" -d data/orders.csv
```

## CI integration

One row in the matrix of [ci.yml](../../.github/workflows/ci.yml):

```yaml
- { package: food-truck-postman, browsers: false, command: npm run test:unit && npm run report && npm run burn-in && npm run breaks }
```

The job uploads `reports/` like every other package, and the dashboard scans and publishes them. `index.html` is the run of folders 01 to 06, so the dashboard links to that one. The JUnit files are next to it. The Dependency audit step allows one triaged advisory, the same Faker 5 inside Newman as [postman-api-collection](../postman-api-collection), in `scripts/audit-allowlist.json`.

## FAQ

### Why a new package and not the existing Postman one?

[postman-api-collection](../postman-api-collection) tests a public demo API, so it can't plant a bug or ask for a declined card. Owning the API means every failure can be made on purpose.

### Why is a timeout not remembered with the key?

Remembering a `504` would make every retry fail for good while the customer's money sits at the provider. A declined card is a real answer and is remembered: to try again, send a new key.

### Why `404` and not `403` for another customer's order?

A `403` confirms the order exists, and that lets someone count orders by trying ids.

### Why is the collection not built from code?

A reader should be able to import one file and see it all, the way a Postman team works. The first version came from a throwaway script; the JSON has been the source since.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Every request fails in Postman with `ECONNREFUSED` | The API isn't running | `npm start`, and choose the **food truck local** environment |
| `Orders from CSV` is skipped in Postman | No data file chosen | Pick `data/orders.csv` in the Collection Runner |
| `food-truck-postman: audit FAILED` | A new high advisory | Update the `overrides` in `package.json` or triage it in `scripts/audit-allowlist.json` |
| `the line to change is gone from src/...` | The code changed under a planted bug | Update `from` in `scripts/breaks.ts` |

## Development

```bash
npm ci
npm run test:unit
npm test
npm run breaks
npx tsc -p tsconfig.json
```

## License

MIT
