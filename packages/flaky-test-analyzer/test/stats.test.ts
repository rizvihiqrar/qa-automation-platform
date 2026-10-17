import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chanceAllPass, runsToDetect, wilson, zeroFailureUpperBound, Z95 } from '../src/stats.ts';

const close = (actual: number, expected: number, digits = 4) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ${expected} to ${digits} places`);

// Small seeded generator (mulberry32), so the simulations give the same answer every run.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const passes = (random: () => number, rate: number, n: number) => {
  let k = 0;
  for (let i = 0; i < n; i++) if (random() >= rate) k++;
  return k;
};

test('wilson matches published 95% intervals', () => {
  // 0/10 and 10/10: the bound is z²/(n + z²) = 0.2775 from the end.
  close(wilson(0, 10).high, 0.2775);
  assert.equal(wilson(0, 10).low, 0);
  close(wilson(10, 10).low, 0.7225);
  assert.equal(wilson(10, 10).high, 1);
  // 5/10: 0.2366–0.7634.
  close(wilson(5, 10).low, 0.2366);
  close(wilson(5, 10).high, 0.7634);
  // Narrows as runs add up: 430/430 still allows a 0.89% failure rate.
  close(wilson(430, 430).low, 0.9911);
});

test('wilson is symmetric and has no data, no answer', () => {
  const a = wilson(3, 20);
  const b = wilson(17, 20);
  close(a.low, 1 - b.high, 12);
  close(a.high, 1 - b.low, 12);
  assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
  assert.throws(() => wilson(5, 4), RangeError);
  assert.throws(() => wilson(-1, 4), RangeError);
  assert.throws(() => wilson(1.5, 4), RangeError);
});

test('wilson covers the true pass rate about 95% of the time, even near 100%', () => {
  // The textbook p ± z·√(p(1−p)/n) interval (Wald) is here only to show why it isn't used:
  // with a 99% pass rate it collapses to [1, 1] whenever all runs pass.
  const wald = (k: number, n: number) => {
    const p = k / n;
    const half = Z95 * Math.sqrt((p * (1 - p)) / n);
    return { low: p - half, high: p + half };
  };
  const random = rng(32);
  const trials = 4000;
  for (const passRate of [0.5, 0.9, 0.99]) {
    let wilsonHits = 0;
    let waldHits = 0;
    for (let t = 0; t < trials; t++) {
      const k = passes(random, 1 - passRate, 50);
      const w = wilson(k, 50);
      const d = wald(k, 50);
      if (w.low <= passRate && passRate <= w.high) wilsonHits++;
      if (d.low <= passRate && passRate <= d.high) waldHits++;
    }
    const coverage = wilsonHits / trials;
    assert.ok(coverage > 0.91 && coverage < 0.99, `Wilson covered ${passRate} in ${coverage} of trials`);
    if (passRate === 0.99) assert.ok(waldHits / trials < 0.7, `Wald covered 0.99 in ${waldHits / trials} of trials`);
  }
});

test('zeroFailureUpperBound: n clean runs rule out rates above roughly 3/n', () => {
  close(zeroFailureUpperBound(5), 0.4507);
  close(zeroFailureUpperBound(10), 0.2589);
  close(zeroFailureUpperBound(14), 0.1926);
  close(zeroFailureUpperBound(100), 0.0295); // rule of three: 0.03
  assert.equal(zeroFailureUpperBound(0), 1);
  assert.throws(() => zeroFailureUpperBound(10, 1), RangeError);
  assert.throws(() => zeroFailureUpperBound(2.5), RangeError);
});

test('runsToDetect gives the runs needed to see a failure 95% of the time', () => {
  assert.deepEqual([1 / 100, 1 / 50, 1 / 20, 1 / 10, 1 / 5].map((r) => runsToDetect(r)), [299, 149, 59, 29, 14]);
  assert.equal(runsToDetect(0.5, 0.75), 2); // 1 − 0.5² is exactly 0.75: no extra run
  assert.equal(runsToDetect(1), 1);
  assert.throws(() => runsToDetect(0), RangeError);
});

test('runsToDetect and zeroFailureUpperBound are the same rule read both ways', () => {
  for (const rate of [0.003, 0.01, 0.05, 0.1, 0.2, 0.37]) {
    const n = runsToDetect(rate);
    assert.ok(zeroFailureUpperBound(n) <= rate, `${n} runs should rule out ${rate}`);
    assert.ok(zeroFailureUpperBound(n - 1) > rate, `${n - 1} runs should not rule out ${rate}`);
  }
});

test('chanceAllPass matches a simulation: a 1-in-10 flaky test passes 14 runs in a row 23% of the time', () => {
  close(chanceAllPass(0.1, 14), 0.2288);
  const random = rng(14);
  const trials = 20000;
  let allPassed = 0;
  for (let t = 0; t < trials; t++) if (passes(random, 0.1, 14) === 14) allPassed++;
  assert.ok(Math.abs(allPassed / trials - 0.2288) < 0.015, `simulated ${allPassed / trials}`);
});
