# sql-data-integrity

SQL checks that find bad data in an orders database: records pointing at things that don't exist, duplicate customers, totals that don't add up, payments that don't match, and dates in the wrong order.

This is the kind of checking that catches what a botched import, a migration, or a manual fix in production leaves behind, before customers or reports notice.

**In plain English:** each check is one rule the data should follow. The tool runs every rule and lists the exact rows that break it.

---

## The Checks

| Check | Severity | Finds |
|---|---|---|
| `orphan_order_items` | error | Order items that point to an order that doesn't exist |
| `orphan_item_products` | error | Order items that point to a product that doesn't exist |
| `orphan_orders` | error | Orders that belong to a customer who doesn't exist |
| `orphan_payments` | error | Payments recorded against an order that doesn't exist |
| `duplicate_customer_emails` | error | The same email, ignoring case and spaces, on more than one customer |
| `invalid_emails` | warning | Emails without a proper domain, or with spaces |
| `order_total_mismatch` | error | Order total ≠ sum of quantity × unit price of its items |
| `orders_without_items` | error | Orders with no items |
| `payment_mismatch` | error | Paid orders not paid exactly their items total; pending or cancelled orders with payments |
| `unknown_status` | error | Order statuses outside the allowed list |
| `status_ship_date_mismatch` | error | Shipped/delivered orders without a ship date, or other orders with one |
| `ship_before_order` | error | Orders shipped before they were placed |
| `non_positive_quantity` | error | Order items with zero or negative quantity |
| `invalid_prices` | error | Products priced at zero or less; items with a negative price |
| `future_dates` | warning | Orders, payments or customers dated in the future |

Each check is one file in `checks/`. Adding a rule means adding one `.sql` file with three header lines (`id`, `severity`, `description`) and a query that returns the offending rows.

---

## Example

`--dataset demo` loads clean data plus six realistic problems: a duplicate account, an email typo, a total that wasn't updated, a refund keyed to the wrong order, a cancelled order that was charged, and a delivery dated before its order.

```
$ npm run check -- --dataset demo

pass  orphan_order_items
pass  orphan_item_products
pass  orphan_orders
FAIL  orphan_payments              1 row(s)
      payment_id=7, order_id=70, amount_cents=2999
FAIL  duplicate_customer_emails    1 row(s)
      email=ben.okafor@example.com, customers=2, customer_ids=2,6
warn  invalid_emails               1 row(s)
      customer_id=3, email=chloe.tran@example
FAIL  order_total_mismatch         1 row(s)
      order_id=1, total_cents=5197, items_total_cents=4997
pass  orders_without_items
FAIL  payment_mismatch             1 row(s)
      order_id=5, status=cancelled, expected_cents=0, paid_cents=2999
pass  unknown_status
pass  status_ship_date_mismatch
FAIL  ship_before_order            1 row(s)
      order_id=6, ordered_at=2026-03-28T10:00:00Z, shipped_at=2026-03-27T09:00:00Z
pass  non_positive_quantity
pass  invalid_prices
pass  future_dates

9/15 checks passed, 5 error(s), 1 warning(s), 6 bad row(s)
```

The command exits with code 1 when any error-level check finds bad rows, so it can block a pipeline step. Warnings are reported but don't fail.

---

## Usage

```bash
npm install
npm run check                          # clean dataset: all 15 pass
npm run check -- --dataset demo        # clean data plus realistic defects
npm run check -- --db path/to/shop.db  # any SQLite file with this schema
npm run check -- --format md           # Markdown table for a PR comment
```

An existing database file is read into memory and never written to.

---

## How the Checks Are Tested

A check that never fails is as useless as no check, so each one is proven both ways:

1. **Clean data:** all 15 checks must return zero rows.
2. **One defect at a time:** 18 defects are injected separately, and each must trigger **exactly** the checks it should. A few legitimately break two rules (a zero quantity also makes the order total wrong); the test lists those.
3. **Coverage:** a test fails if any check isn't triggered by at least one defect.

To confirm the tests themselves work, two checks were broken on purpose: one flipped so it fired on good data, and one changed so it could never fire. Both were caught.

```bash
npm test   # 35 tests, Node built-in test runner
```

---

## Design Notes

- **Money in cents:** amounts are whole cents, so `4997 = 2999 + 2 × 999` compares exactly. Floating-point dollars can make correct totals look wrong.
- **No enforced foreign keys:** real systems often lack them or have them switched off for imports. The checks find what the database didn't stop.
- **Payments compare against item totals,** not the order total, so one wrong order total is reported once instead of twice.
- **SQLite through sql.js** (WebAssembly): runs the same on Windows, macOS and Linux CI with nothing native to install.
- **Strict TypeScript, no build:** Node 24 runs the `.ts` files directly. Moving to TypeScript (Day 21) also surfaced a Windows-only bug. With Git's CRLF line endings, `.` in the header regex didn't match the trailing `\r`, so every check file was rejected on Windows. CI runs on Linux and never saw it. Headers are now split on `\r?\n`, and a test covers CRLF input. A flag given without a value, such as `--format` at the end, now fails clearly instead of quietly using the default.

---

## Structure

```
├── schema/
│   ├── schema.sql          # Tables
│   └── seed-clean.sql      # Consistent data: every check passes
├── checks/                 # One rule per .sql file
├── datasets/
│   └── demo-defects.sql    # Realistic bad data for the demo
├── src/
│   ├── integrity.ts        # Load checks, build databases, run checks
│   ├── report.ts           # Text and Markdown output
│   └── cli.ts
└── test/
```
