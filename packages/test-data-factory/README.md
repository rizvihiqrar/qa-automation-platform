# test-data-factory

A CLI that generates realistic test data (users, orders, products) with [Faker](https://fakerjs.dev) and exports it as JSON, CSV, or SQL `INSERT` statements.

**In plain English:** Tests need realistic but fake data: names, orders, products. This generates as much as needed, and the same data every time when asked, so tests are repeatable and no real customer data is ever used.

---

## Usage

```bash
npm install

node src/index.ts --type users    --count 50  --format json --output output/users.json
node src/index.ts --type orders   --count 100 --format csv  --output output/orders.csv
node src/index.ts --type products --count 20  --format sql  --table products --output output/seed.sql

# Reproducible data: the same seed gives byte-identical output
node src/index.ts --type orders --count 5 --seed 42
```

| Option | Default | Notes |
|---|---|---|
| `--type` | `users` | `users`, `orders`, `products` |
| `--count` | `10` | Positive whole number. Bad values exit with an error instead of writing an empty file. |
| `--format` | `json` | `json`, `csv`, `sql` |
| `--output` | stdout | Folders are created as needed |
| `--table` | the type | Table name for SQL output |
| `--seed` | none | Fixes both the random seed and the reference date, so dates repeat too |
| `--run` | none | A run name (lower-case letters, digits, dashes, up to 16): gives one parallel worker its own data. See [Parallel Runs](#parallel-runs) |

---

## Data Rules

- Order `total` always equals `quantity × unitPrice`, rounded to cents.
- Only `shipped` and `delivered` orders have a `shippedAt`, and it's never before `orderedAt`.
- CSV flattens nested objects into prefixed columns (`address_city`) and quotes commas, quotes, and newlines.
- SQL escapes single quotes, writes booleans as `1`/`0` and nulls as `NULL`, and stores nested objects as JSON text.

---

## Parallel Runs

Workers started with the same `--seed` get the same records, so two of them insert the same id, email and username and one fails, or reads the other's rows. `--run <name>` gives each worker its own data:

```bash
node src/index.ts --type users --count 25 --seed 42 --run worker-3
```

- The seed is mixed with the run name, so each run is different and still reproducible: the same seed and run name always print the same data.
- The keys that must be unique (`id`, `orderId`, `userId`, `email`, `username`, `sku`) are stamped with a code made from the run name, so two runs with different names do not share one, whatever the random numbers did (short of a hash collision of the two names: about 1 in 4 billion, and 1 in 1.7 million for a SKU). Ids stay valid UUIDs, emails stay valid addresses (`name.worker-3@example.com`) and a SKU stays 8 characters.
- Without `--run` nothing changes: existing seeds keep their data. With `--run` but no `--seed` the data is random and only the keys are stamped.
- `findCollisions` (in `src/isolation.ts`) lists every key found in more than one run.

`npm run parallel-demo` starts four workers at once with the same seed and counts shared keys:

| Type | Records | Collisions without --run | Collisions with --run |
|---|---:|---:|---:|
| users | 100 | 75 | 0 |
| orders | 100 | 50 | 0 |
| products | 100 | 50 | 0 |

The numbers in this table are checked by the test suite (ISO-01 and ISO-02). (Users share three keys per record, id, email and username, so 25 records give 75; orders share their order and user ids and products their id and SKU.) Limit: only the six key fields are stamped. A field that is unique in your own database but not in this list is not protected.

---

## TypeScript

Written in TypeScript and run directly by Node 24, which strips the types (no build step). `src/types.ts` defines `User`, `Order` and `Product`; the order status is a union of the five allowed values, and `shippedAt` is `string | null`. Strict type-checking runs in CI (`npm run typecheck` at the repo root).

Moving to strict TypeScript surfaced places where the tests used a value without first checking it existed (a CSV row, a generated user, a ship date). Each now asserts it first, which also makes the test failure message clearer.

---

## Tests

```bash
npm test   # 36 tests, Node built-in test runner
```

| File | Covers |
|---|---|
| `test/generators.test.js` | Record counts, id uniqueness, email format, order totals, ship-date rules, seeding |
| `test/exporters.test.js` | CSV flattening and quoting, SQL escaping, JSON round-trip, empty input |
| `test/isolation.test.ts` | Parallel runs: same-seed workers collide, `--run` workers share no key, reproducibility, stamping keeps records valid, the collision check, run-name rules |
| `test/cli.test.js` | Argument validation, exit codes, seeded output, SQL table names |

Two bugs were fixed while writing these tests: orders could have a ship date before their order date (or for orders that never shipped), and `--count abc` silently produced empty output.
