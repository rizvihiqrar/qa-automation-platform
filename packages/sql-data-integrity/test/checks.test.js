import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, createDemoDatabase, loadChecks, runChecks, summarizeResults } from '../src/integrity.js';

const checks = loadChecks();
const fired = (results) => results.filter((r) => r.rows.length > 0 || r.error).map((r) => r.id).sort();

// One defect at a time on top of the clean seed, and the exact set of checks it
// should trigger. Some defects legitimately break two rules (a zero quantity
// also makes the order total wrong), and those are listed explicitly.
const DEFECTS = [
  { name: 'item points to a missing order', sql: 'INSERT INTO order_items VALUES (100, 999, 1, 1, 2999);', expect: ['orphan_order_items'] },
  { name: 'item points to a missing product', sql: 'UPDATE order_items SET product_id = 999 WHERE id = 6;', expect: ['orphan_item_products'] },
  { name: 'order belongs to a missing customer', sql: 'UPDATE orders SET customer_id = 999 WHERE id = 4;', expect: ['orphan_orders'] },
  { name: 'payment for a missing order', sql: "INSERT INTO payments VALUES (20, 999, 500, '2026-03-30T10:00:00Z');", expect: ['orphan_payments'] },
  { name: 'same email with different casing', sql: "INSERT INTO customers VALUES (6, 'Ana.Silva@Example.com', 'Ana S', '2026-04-01T10:00:00Z');", expect: ['duplicate_customer_emails'] },
  { name: 'email without a domain dot', sql: "UPDATE customers SET email = 'dev.patel@example' WHERE id = 4;", expect: ['invalid_emails'] },
  { name: 'email with a space', sql: "UPDATE customers SET email = 'erin walsh@example.com' WHERE id = 5;", expect: ['invalid_emails'] },
  { name: 'order total off by one dollar', sql: 'UPDATE orders SET total_cents = total_cents + 100 WHERE id = 1;', expect: ['order_total_mismatch'] },
  { name: 'order with no items', sql: 'DELETE FROM order_items WHERE order_id = 4;', expect: ['orders_without_items'] },
  { name: 'delivered order underpaid', sql: 'UPDATE payments SET amount_cents = 4000 WHERE id = 1;', expect: ['payment_mismatch'] },
  { name: 'cancelled order charged', sql: "INSERT INTO payments VALUES (21, 5, 2999, '2026-03-25T13:05:00Z');", expect: ['payment_mismatch'] },
  { name: 'unknown status', sql: "UPDATE orders SET status = 'refunded' WHERE id = 5;", expect: ['unknown_status'] },
  { name: 'pending order with a ship date', sql: "UPDATE orders SET shipped_at = '2026-03-23T10:00:00Z' WHERE id = 4;", expect: ['status_ship_date_mismatch'] },
  { name: 'delivered order without a ship date', sql: 'UPDATE orders SET shipped_at = NULL WHERE id = 6;', expect: ['status_ship_date_mismatch'] },
  { name: 'shipped before it was ordered', sql: "UPDATE orders SET shipped_at = '2026-03-01T00:00:00Z' WHERE id = 2;", expect: ['ship_before_order'] },
  { name: 'zero quantity', sql: 'UPDATE order_items SET quantity = 0 WHERE id = 6;', expect: ['non_positive_quantity', 'order_total_mismatch'] },
  { name: 'product priced below zero', sql: 'UPDATE products SET price_cents = -1 WHERE id = 6;', expect: ['invalid_prices'] },
  { name: 'order dated in the future', sql: "UPDATE orders SET ordered_at = '2999-01-01T00:00:00Z' WHERE id = 4;", expect: ['future_dates'] },
];

test('all 15 checks load with unique ids', () => {
  assert.equal(checks.length, 15);
});

test('the clean dataset passes every check', async () => {
  const results = runChecks(await createDatabase(), checks);
  assert.deepEqual(fired(results), []);
  assert.deepEqual(summarizeResults(results), { checks: 15, passed: 15, errors: 0, warnings: 0, badRows: 0 });
});

for (const { name, sql, expect } of DEFECTS) {
  test(`defect "${name}" triggers exactly: ${expect.join(', ')}`, async () => {
    const results = runChecks(await createDatabase({ extraSql: [sql] }), checks);
    assert.deepEqual(fired(results), [...expect].sort());
  });
}

test('every check is proven by at least one defect', () => {
  const covered = new Set(DEFECTS.flatMap((d) => d.expect));
  const untested = checks.map((c) => c.id).filter((id) => !covered.has(id));
  assert.deepEqual(untested, []);
});

test('a split payment that adds up is not flagged', async () => {
  // Order 7 in the seed is paid in two parts: 5000 + 4998 = 9998.
  const results = runChecks(await createDatabase(), checks);
  assert.equal(results.find((r) => r.id === 'payment_mismatch').rows.length, 0);
});

test('a failing check reports the offending rows', async () => {
  const db = await createDatabase({ extraSql: ['UPDATE orders SET total_cents = 5197 WHERE id = 1;'] });
  const r = runChecks(db, checks).find((x) => x.id === 'order_total_mismatch');
  assert.deepEqual(r.columns, ['order_id', 'total_cents', 'items_total_cents']);
  assert.deepEqual(r.rows, [[1, 5197, 4997]]);
});

test('the demo dataset triggers the six problems it describes', async () => {
  const results = runChecks(await createDemoDatabase(), checks);
  assert.deepEqual(fired(results), [
    'duplicate_customer_emails', 'invalid_emails', 'order_total_mismatch',
    'orphan_payments', 'payment_mismatch', 'ship_before_order',
  ]);
  const s = summarizeResults(results);
  assert.equal(s.errors, 5);
  assert.equal(s.warnings, 1);
});

test('a check that cannot run is reported as an error, not skipped', async () => {
  const broken = [{ id: 'broken', severity: 'warning', description: 'x', sql: 'SELECT * FROM missing_table;' }];
  const [r] = runChecks(await createDatabase(), broken);
  assert.equal(r.severity, 'error');
  assert.match(r.error, /no such table/);
});
