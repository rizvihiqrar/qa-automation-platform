import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DELIVERY_FEE_CENTS, priceOrder, taxOn } from '../src/money.ts';

test('tax is 13% rounded half up', () => {
  assert.equal(taxOn(350), 46); // 45.5
  assert.equal(taxOn(750), 98); // 97.5
  assert.equal(taxOn(749), 97); // 97.37
  assert.equal(taxOn(0), 0);
});

test('tax is worked out once on the order, not once per item', () => {
  const lines = [{ quantity: 3, unit_price_cents: 250 }];
  assert.equal(priceOrder(lines, 'pickup').tax_cents, 98);
  assert.notEqual(priceOrder(lines, 'pickup').tax_cents, 3 * taxOn(250), 'per item would be 99');
});

test('delivery adds a flat fee, and the fee is taxed', () => {
  const totals = priceOrder([{ quantity: 1, unit_price_cents: 250 }], 'delivery');
  assert.deepEqual(totals, { subtotal_cents: 250, delivery_fee_cents: DELIVERY_FEE_CENTS, tax_cents: 97, total_cents: 846 });
});

test('the parts always add up to the total', () => {
  for (let price = 1; price <= 3000; price += 7) {
    const totals = priceOrder([{ quantity: 3, unit_price_cents: price }], 'delivery');
    assert.equal(totals.subtotal_cents + totals.delivery_fee_cents + totals.tax_cents, totals.total_cents);
    assert.ok(Number.isInteger(totals.tax_cents));
  }
});
