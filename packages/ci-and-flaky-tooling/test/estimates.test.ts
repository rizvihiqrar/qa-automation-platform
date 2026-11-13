import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../src/build.ts';
import { checkEstimates, estimatesMarkdown, readEstimates, releaseRows, slope, totals, trend, type EstimateData } from '../src/estimates.ts';

// Worked out by hand for data/releases.json:
//   R1 40 est, 38 actual: -2 h, -5.0%      R2 50, 55: +5 h, +10.0%     R3 30, 36: +6 h, +20.0%
//   R4 60, 75: +15 h, +25.0%               R5 45, 54: +9 h, +20.0%     R6 80, 100: +20 h, +25.0%
// Over 10%: R3, R4, R5, R6 (R2 is exactly 10%, so not over). Totals 305 est, 358 actual: +53 h, +17.4%.
// Trend over the last five (R2 to R6), y = 10, 20, 25, 20, 25 at x = 0..4: mean x 2, mean y 20,
// sum of (x - 2)(y - 20) = 20 + 0 + 0 + 0 + 10 = 30, sum of (x - 2)^2 = 10, slope = 3.0 points per release.
const HAND_PERCENT = [-5, 10, 20, 25, 20, 25];
const HAND_HOURS = [-2, 5, 6, 15, 9, 20];

const sample = (over: Partial<EstimateData> = {}): EstimateData => ({ ...readEstimates(), ...over });

test('the sample data has no problems', () => {
  assert.deepEqual(checkEstimates(readEstimates()), []);
});

test('every release matches the hand calculation', () => {
  const rows = releaseRows(readEstimates());
  assert.deepEqual(rows.map((r) => r.variancePercent), HAND_PERCENT);
  assert.deepEqual(rows.map((r) => r.varianceHours), HAND_HOURS);
});

test('a release is over budget only when it is more than the limit over: exactly 10% is not flagged', () => {
  assert.deepEqual(releaseRows(readEstimates()).map((r) => r.overBudget), [false, false, true, true, true, true]);
  assert.deepEqual(releaseRows(sample({ overBudgetPercent: 9.9 })).map((r) => r.overBudget), [false, true, true, true, true, true]);
});

test('the totals match the hand calculation', () => {
  assert.deepEqual(totals(readEstimates()), { estimateHours: 305, actualHours: 358, variancePercent: 17.4 });
});

test('the trend line uses the last five releases and its slope matches the hand calculation', () => {
  assert.deepEqual(trend(readEstimates()), { releases: ['R2', 'R3', 'R4', 'R5', 'R6'], slope: 3, direction: 'over-runs growing' });
  assert.equal(slope([10, 20, 25, 20, 25]), 3);
});

test('the direction says shrinking, growing or steady', () => {
  const data = (actuals: number[]): EstimateData => sample({ trendReleases: actuals.length, releases: actuals.map((a, i) => ({ release: `r${i}`, estimateHours: 100, actualHours: a })) });
  assert.equal(trend(data([130, 120, 110, 105]))!.direction, 'over-runs shrinking');
  assert.equal(trend(data([100, 110, 120, 130]))!.direction, 'over-runs growing');
  assert.equal(trend(data([110, 110, 110, 110]))!.direction, 'steady');
  assert.equal(trend(data([110, 111, 110, 111]))!.direction, 'steady'); // 0.2 points per release is noise
});

test('one release is not a trend', () => {
  assert.equal(trend(sample({ trendReleases: 5, releases: [{ release: 'only', estimateHours: 10, actualHours: 12 }] })), null);
});

test('bad data is reported', () => {
  const good = readEstimates();
  assert.match(checkEstimates(sample({ releases: [...good.releases, good.releases[0]!] }))[0]!, /R1: listed twice/);
  assert.match(checkEstimates(sample({ releases: [{ release: 'z', estimateHours: 0, actualHours: 5 }] }))[0]!, /z: the estimate must be above 0 hours/);
  assert.match(checkEstimates(sample({ releases: [{ release: 'z', estimateHours: 5, actualHours: -1 }] }))[0]!, /cannot be negative/);
  assert.match(checkEstimates(sample({ trendReleases: 1 }))[0]!, /trendReleases must be a whole number of 2 or more/);
  assert.match(checkEstimates(sample({ overBudgetPercent: -1 }))[0]!, /overBudgetPercent must be 0 or more/);
  assert.deepEqual(checkEstimates(sample({ releases: [] })), ['releases must be a list with at least one release']);
  assert.deepEqual(checkEstimates(sample({ releases: undefined as never })), ['releases must be a list with at least one release']);
});

test('the page flags the over-budget releases and states the trend', () => {
  const md = estimatesMarkdown(readEstimates());
  assert.ok(md.includes('| R1 | 40 | 38 | -2 | -5% |  |'));
  assert.ok(md.includes('| R2 | 50 | 55 | +5 | +10% |  |'));
  assert.ok(md.includes('| R4 | 60 | 75 | +15 | +25% | Over budget (more than 10% over) |'));
  assert.ok(md.includes('Over budget: 4 of 6 releases (R3, R4, R5, R6).'));
  assert.ok(md.includes('All releases together: 305 hours estimated, 358 hours actual (+17.4%).'));
  assert.ok(md.includes('Trend over the last 5 releases (R2, R3, R4, R5, R6): +3 percentage points per release, so over-runs growing.'));
});

test('docs/estimates.md is the current output (run npm run planning)', () => {
  assert.equal(fs.readFileSync(path.join(packageRoot, 'docs', 'estimates.md'), 'utf8'), estimatesMarkdown(readEstimates()));
});
