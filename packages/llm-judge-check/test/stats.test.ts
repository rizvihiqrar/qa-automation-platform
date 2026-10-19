import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agreement, confusion, describeKappa, flagged, kappa, kappaInterval, majority, unanimous, type Verdict } from '../src/stats.ts';

const repeat = (v: Verdict, n: number): Verdict[] => Array.from({ length: n }, () => v);

test('perfect agreement is kappa 1', () => {
  const h: Verdict[] = ['covered', 'partial', 'missing', 'covered'];
  assert.equal(kappa(h, h), 1);
  assert.equal(kappa(h, h, true), 1);
});

test('a judge that always says covered scores high agreement and kappa 0', () => {
  const human = [...repeat('covered', 45), ...repeat('partial', 5)];
  const judge = repeat('covered', 50);
  assert.equal(agreement(human, judge).rate, 0.9);
  assert.equal(kappa(human, judge), 0);
  assert.equal(flagged(human, judge).recall, 0);
});

test('kappa matches a hand-worked two-category example', () => {
  // 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no (n = 50): po = 0.7, pe = 0.5, kappa = 0.4
  const human: Verdict[] = [...repeat('covered', 25), ...repeat('missing', 25)];
  const judge: Verdict[] = [...repeat('covered', 20), ...repeat('missing', 5), ...repeat('covered', 10), ...repeat('missing', 15)];
  assert.ok(Math.abs(kappa(human, judge) - 0.4) < 1e-12);
});

test('weighted kappa counts partial-for-missing as half an error', () => {
  const human: Verdict[] = ['covered', 'partial', 'missing', 'missing'];
  const nearMiss: Verdict[] = ['covered', 'partial', 'partial', 'missing'];
  const farMiss: Verdict[] = ['covered', 'partial', 'covered', 'missing'];
  assert.equal(kappa(human, nearMiss), kappa(human, farMiss)); // unweighted: both one error
  assert.ok(kappa(human, nearMiss, true) > kappa(human, farMiss, true));
});

test('kappa is undefined when both raters used a single verdict', () => {
  assert.ok(Number.isNaN(kappa(repeat('covered', 5), repeat('covered', 5))));
  assert.equal(describeKappa(Number.NaN), 'undefined');
});

test('confusion rows are human labels, columns judge verdicts', () => {
  const m = confusion(['covered', 'missing'], ['missing', 'missing']);
  assert.equal(m.covered.missing, 1);
  assert.equal(m.missing.missing, 1);
  assert.equal(m.missing.covered, 0);
});

test('flagged counts weak tests caught and false alarms', () => {
  const human: Verdict[] = ['covered', 'covered', 'partial', 'missing'];
  const judge: Verdict[] = ['covered', 'missing', 'missing', 'covered'];
  const f = flagged(human, judge);
  assert.deepEqual([f.weak, f.caught, f.falseAlarms], [2, 1, 1]);
  assert.equal(f.recall, 0.5);
  assert.equal(f.precision, 0.5);
});

test('majority breaks ties toward the stricter verdict', () => {
  assert.equal(majority(['covered', 'covered', 'missing']), 'covered');
  assert.equal(majority(['covered', 'partial', 'missing']), 'missing');
  assert.equal(majority(['covered', 'partial']), 'partial');
});

test('unanimous counts cases where every run agreed', () => {
  assert.deepEqual(unanimous([['covered', 'partial'], ['covered', 'missing']]), { same: 1, n: 2 });
});

test('the bootstrap interval is repeatable and contains the estimate', () => {
  const human: Verdict[] = [...repeat('covered', 30), ...repeat('partial', 10), ...repeat('missing', 10)];
  const judge: Verdict[] = [...repeat('covered', 28), ...repeat('partial', 2), ...repeat('partial', 8), ...repeat('missing', 2), ...repeat('missing', 10)];
  const a = kappaInterval(human, judge);
  assert.deepEqual(kappaInterval(human, judge), a);
  const k = kappa(human, judge);
  assert.ok(a.low <= k && k <= a.high);
});

test('mismatched lengths are refused', () => {
  assert.throws(() => kappa(['covered'], []));
  assert.throws(() => confusion(['covered'], ['covered', 'missing']));
});
