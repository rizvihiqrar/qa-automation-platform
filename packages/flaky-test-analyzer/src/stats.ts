// The statistics behind "is this test flaky, and how sure are we?".
//
// A test run is a coin flip with an unknown chance of failing. A handful of runs
// can't measure that chance exactly, so every rate here comes with a range:
//   - wilson(): the 95% confidence interval for a pass rate (Wilson score interval,
//     which stays sensible at 0 or n successes, unlike the textbook p ± z·√(p(1−p)/n)).
//   - zeroFailureUpperBound(): after n clean runs, the highest failure rate still
//     consistent with what was seen. "Never failed" never means "can't fail".
//   - runsToDetect(): how many runs it takes to see at least one failure from a test
//     that fails at a given rate. The same formula, read the other way.

/** z for a two-sided 95% interval. */
export const Z95 = 1.959963984540054;

export interface Interval {
  low: number;
  high: number;
}

/** Wilson score interval for `successes` out of `n` (both 0–1). */
export function wilson(successes: number, n: number, z: number = Z95): Interval {
  if (!Number.isInteger(n) || n < 0 || !Number.isInteger(successes) || successes < 0 || successes > n) {
    throw new RangeError(`need 0 <= successes <= n, got ${successes} of ${n}`);
  }
  if (n === 0) return { low: 0, high: 1 }; // no data: anything is possible
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // Clamp the exact ends so 0/n and n/n report 0 and 1, not 1e-17.
  return {
    low: successes === 0 ? 0 : Math.max(0, centre - half),
    high: successes === n ? 1 : Math.min(1, centre + half),
  };
}

const checkConfidence = (confidence: number): void => {
  if (!(confidence > 0 && confidence < 1)) throw new RangeError(`confidence must be between 0 and 1, got ${confidence}`);
};

/**
 * After `n` runs with no failure, the failure rate is below this, at the given
 * confidence (exact one-sided bound: 1 − (1 − confidence)^(1/n)). For 95% it is
 * close to the "rule of three", 3/n.
 */
export function zeroFailureUpperBound(n: number, confidence = 0.95): number {
  checkConfidence(confidence);
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be a whole number, got ${n}`);
  if (n === 0) return 1;
  return 1 - (1 - confidence) ** (1 / n);
}

/**
 * Runs needed to see at least one failure, with the given probability, from a test
 * that fails at `rate`. Equally: clean runs needed before you can say, at that
 * confidence, the failure rate is below `rate`.
 */
export function runsToDetect(rate: number, confidence = 0.95): number {
  checkConfidence(confidence);
  if (!(rate > 0 && rate <= 1)) throw new RangeError(`rate must be above 0 and at most 1, got ${rate}`);
  if (rate === 1) return 1;
  // The small epsilon keeps exact cases (e.g. 0.5 at 75%) from rounding up a run.
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - rate) - 1e-9);
}

/** Chance that a test failing at `rate` passes all `n` runs anyway. */
export function chanceAllPass(rate: number, n: number): number {
  return (1 - rate) ** n;
}
