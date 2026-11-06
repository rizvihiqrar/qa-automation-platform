import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAFF_STEPS, STATUSES, allowedNext, type Status } from '../src/status.ts';

test('a delivery goes through the driver and a pickup skips it', () => {
  assert.deepEqual(allowedNext('ready', 'delivery'), ['out_for_delivery']);
  assert.deepEqual(allowedNext('ready', 'pickup'), ['picked_up']);
});

test('cancelling is possible only before preparing', () => {
  const cancellable = STATUSES.filter((status) => allowedNext(status, 'delivery').includes('cancelled'));
  assert.deepEqual(cancellable, ['placed', 'paid']);
});

test('finished orders go nowhere', () => {
  for (const end of ['delivered', 'picked_up', 'cancelled'] as Status[]) {
    assert.deepEqual(allowedNext(end, 'delivery'), []);
    assert.deepEqual(allowedNext(end, 'pickup'), []);
  }
});

test('each order type reaches its own end, never the other one', () => {
  const reachable = (fulfilment: 'pickup' | 'delivery'): Set<Status> => {
    const seen = new Set<Status>(['placed']);
    for (const status of seen) for (const next of allowedNext(status, fulfilment)) seen.add(next);
    return seen;
  };
  assert.ok(reachable('delivery').has('delivered'));
  assert.ok(!reachable('delivery').has('picked_up'));
  assert.ok(reachable('pickup').has('picked_up'));
  assert.ok(!reachable('pickup').has('out_for_delivery'));
});

test('staff steps never include paying or cancelling', () => {
  assert.ok(!STAFF_STEPS.includes('paid'));
  assert.ok(!STAFF_STEPS.includes('cancelled'));
});
