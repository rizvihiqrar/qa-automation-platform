# test-data-factory

A CLI that generates realistic test data (users, orders, products) with [Faker](https://fakerjs.dev) and exports it as JSON, CSV, or SQL `INSERT` statements.

---

## Usage

```bash
npm install

node src/index.js --type users    --count 50  --format json --output output/users.json
node src/index.js --type orders   --count 100 --format csv  --output output/orders.csv
node src/index.js --type products --count 20  --format sql  --table products --output output/seed.sql

# Reproducible data: the same seed gives byte-identical output
node src/index.js --type orders --count 5 --seed 42
```

| Option | Default | Notes |
|---|---|---|
| `--type` | `users` | `users`, `orders`, `products` |
| `--count` | `10` | Positive whole number. Bad values exit with an error instead of writing an empty file. |
| `--format` | `json` | `json`, `csv`, `sql` |
| `--output` | stdout | Folders are created as needed |
| `--table` | the type | Table name for SQL output |
| `--seed` | none | Fixes both the random seed and the reference date, so dates repeat too |

---

## Data Rules

- Order `total` always equals `quantity × unitPrice`, rounded to cents.
- Only `shipped` and `delivered` orders have a `shippedAt`, and it's never before `orderedAt`.
- CSV flattens nested objects into prefixed columns (`address_city`) and quotes commas, quotes, and newlines.
- SQL escapes single quotes, writes booleans as `1`/`0` and nulls as `NULL`, and stores nested objects as JSON text.

---

## Tests

```bash
npm test   # 25 tests, Node built-in test runner
```

| File | Covers |
|---|---|
| `test/generators.test.js` | Record counts, id uniqueness, email format, order totals, ship-date rules, seeding |
| `test/exporters.test.js` | CSV flattening and quoting, SQL escaping, JSON round-trip, empty input |
| `test/cli.test.js` | Argument validation, exit codes, seeded output, SQL table names |

Two bugs were fixed while writing these tests: orders could have a ship date before their order date (or for orders that never shipped), and `--count abc` silently produced empty output.
