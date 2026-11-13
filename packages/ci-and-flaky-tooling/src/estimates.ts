// Estimate against actuals per release: for each release the hours that were estimated and the
// hours it took, the variance in hours and in percent, a flag when a release ran over budget, and
// a trend line over the last few releases that says whether the over-runs are growing or shrinking.
// Percent variance is (actual - estimate) / estimate: above zero means it took longer than planned.
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from './build.ts';

export interface Release {
  release: string;
  estimateHours: number;
  actualHours: number;
}

export interface EstimateData {
  label: string;
  /** A release is flagged when it ran over its estimate by more than this many percent. */
  overBudgetPercent: number;
  /** The trend line uses this many of the latest releases. */
  trendReleases: number;
  releases: Release[];
}

export function readEstimates(): EstimateData {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'data', 'releases.json'), 'utf8')) as EstimateData;
}

/** One message per problem in the data. An estimate of zero would make the percent meaningless. */
export function checkEstimates(data: EstimateData): string[] {
  const problems: string[] = [];
  if (!Array.isArray(data.releases) || data.releases.length === 0) return ['releases must be a list with at least one release'];
  if (!(data.overBudgetPercent >= 0)) problems.push(`overBudgetPercent must be 0 or more, not ${data.overBudgetPercent}`);
  if (!Number.isInteger(data.trendReleases) || data.trendReleases < 2) problems.push(`trendReleases must be a whole number of 2 or more (a line needs two points), not ${data.trendReleases}`);
  const names = new Set<string>();
  for (const r of data.releases) {
    if (names.has(r.release)) problems.push(`${r.release}: listed twice`);
    names.add(r.release);
    if (!(r.estimateHours > 0)) problems.push(`${r.release}: the estimate must be above 0 hours`);
    if (!(r.actualHours >= 0)) problems.push(`${r.release}: the actual hours cannot be negative`);
  }
  return problems;
}

export interface ReleaseRow extends Release {
  varianceHours: number;
  variancePercent: number;
  overBudget: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function releaseRows(data: EstimateData): ReleaseRow[] {
  return data.releases.map((r) => {
    const variancePercent = round1(((r.actualHours - r.estimateHours) / r.estimateHours) * 100);
    return { ...r, varianceHours: round1(r.actualHours - r.estimateHours), variancePercent, overBudget: variancePercent > data.overBudgetPercent };
  });
}

/** Least-squares slope of y against 0, 1, 2, ...: how much y changes per step. */
export function slope(ys: number[]): number {
  const n = ys.length;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  ys.forEach((y, x) => {
    sxy += (x - meanX) * (y - meanY);
    sxx += (x - meanX) ** 2;
  });
  return sxx === 0 ? 0 : sxy / sxx;
}

export interface Trend {
  releases: string[];
  /** Change in percent variance per release, to one decimal. */
  slope: number;
  direction: 'over-runs growing' | 'over-runs shrinking' | 'steady';
}

/** Under half a percentage point per release is steady: a line through six noisy points always tilts a little. */
const STEADY_BELOW = 0.5;

export function trend(data: EstimateData): Trend | null {
  const rows = releaseRows(data).slice(-data.trendReleases);
  if (rows.length < 2) return null;
  const s = slope(rows.map((r) => r.variancePercent));
  return { releases: rows.map((r) => r.release), slope: round1(s), direction: Math.abs(s) < STEADY_BELOW ? 'steady' : s > 0 ? 'over-runs growing' : 'over-runs shrinking' };
}

export interface Totals { estimateHours: number; actualHours: number; variancePercent: number }

export function totals(data: EstimateData): Totals {
  const estimateHours = data.releases.reduce((a, r) => a + r.estimateHours, 0);
  const actualHours = data.releases.reduce((a, r) => a + r.actualHours, 0);
  return { estimateHours, actualHours, variancePercent: round1(((actualHours - estimateHours) / estimateHours) * 100) };
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function estimatesMarkdown(data: EstimateData): string {
  const rows = releaseRows(data);
  const t = trend(data);
  const all = totals(data);
  const row = (r: ReleaseRow) => `| ${r.release} | ${r.estimateHours} | ${r.actualHours} | ${signed(r.varianceHours)} | ${signed(r.variancePercent)}% | ${r.overBudget ? `Over budget (more than ${data.overBudgetPercent}% over)` : ''} |`;
  const over = rows.filter((r) => r.overBudget);
  return [
    '# Estimates Against Actuals',
    '',
    data.label,
    '',
    'Made from `data/releases.json` by `npm run planning`. Variance is actual hours minus estimated hours; the percent is that divided by the estimate, so above zero means the release took longer than planned. A release is flagged when it is more than ' + `${data.overBudgetPercent}% over. A test compares the numbers with a hand calculation.`,
    '',
    '| Release | Estimate (h) | Actual (h) | Variance (h) | Variance | Flag |',
    '|---|---|---|---|---|---|',
    ...rows.map(row),
    '',
    `Over budget: ${over.length} of ${rows.length} releases (${over.map((r) => r.release).join(', ') || 'none'}).`,
    `All releases together: ${all.estimateHours} hours estimated, ${all.actualHours} hours actual (${signed(all.variancePercent)}%).`,
    t ? `Trend over the last ${t.releases.length} releases (${t.releases.join(', ')}): ${signed(t.slope)} percentage points per release, so ${t.direction}.` : 'Trend: not enough releases for a line.',
    '',
  ].join('\n');
}
