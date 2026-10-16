import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { generateUsers } from '../src/generators/userGenerator.js';
import { generateOrders, generateOrder, STATUSES } from '../src/generators/orderGenerator.js';
import { generateProducts } from '../src/generators/productGenerator.js';
import { applySeed } from '../src/index.js';

beforeEach(() => applySeed(1234));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('generators return the requested number of records', () => {
  assert.equal(generateUsers(7).length, 7);
  assert.equal(generateOrders(3).length, 3);
  assert.equal(generateProducts(0).length, 0);
});

test('users have valid ids, lower-case emails and ISO dates', () => {
  for (const u of generateUsers(25)) {
    assert.match(u.id, UUID);
    assert.equal(u.email, u.email.toLowerCase());
    assert.match(u.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    assert.ok(!Number.isNaN(Date.parse(u.createdAt)));
    assert.equal(u.address.country, 'US');
  }
});

test('user ids are unique within a batch', () => {
  const ids = generateUsers(200).map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('order totals equal quantity times unit price', () => {
  for (const o of generateOrders(50)) {
    assert.ok(o.quantity >= 1 && o.quantity <= 5);
    assert.equal(o.total, Number((o.quantity * o.unitPrice).toFixed(2)));
    assert.ok(STATUSES.includes(o.status));
  }
});

test('only shipped or delivered orders have a ship date', () => {
  for (const o of generateOrders(200)) {
    const shipped = o.status === 'shipped' || o.status === 'delivered';
    assert.equal(o.shippedAt !== null, shipped, `${o.status} order has shippedAt=${o.shippedAt}`);
  }
});

test('an order is never shipped before it was placed', () => {
  for (const o of generateOrders(200, { status: 'delivered' })) {
    assert.ok(Date.parse(o.shippedAt) >= Date.parse(o.orderedAt), `${o.shippedAt} < ${o.orderedAt}`);
  }
});

test('a forced non-shipping status has no ship date', () => {
  assert.equal(generateOrder({ status: 'cancelled' }).shippedAt, null);
});

test('products have stock within range and a positive price', () => {
  for (const p of generateProducts(50)) {
    assert.ok(p.stock >= 0 && p.stock <= 500);
    assert.ok(p.price > 0);
    assert.match(p.sku, /^[A-Z0-9]{8}$/);
  }
});

test('overrides replace generated fields', () => {
  const [u] = generateUsers(1, { email: 'qa@example.com' });
  assert.equal(u.email, 'qa@example.com');
});

test('the same seed produces the same data, dates included', () => {
  applySeed(99);
  const a = generateOrders(5);
  applySeed(99);
  const b = generateOrders(5);
  assert.deepEqual(a, b);
});

test('seeded orders are never shipped after the reference date', () => {
  for (const o of generateOrders(100, { status: 'shipped' })) {
    assert.ok(Date.parse(o.shippedAt) <= faker.defaultRefDate().getTime());
  }
});
