// How far to trust a judge: agreement with the human labels, corrected for chance.
//
//   - agreement: share of cases where the judge gave the human's verdict.
//   - Cohen's kappa: agreement beyond what two raters would reach by guessing with
//     their own label frequencies. On a set where most answers are "covered", a judge
//     that always says "covered" scores high agreement and a kappa of 0.
//   - weighted kappa: the same, but "partial" for "missing" counts as half wrong
//     instead of wholly wrong (the verdicts are ordered).
//   - flagged / missed: the QA view. A weak test (partial or missing) is the thing a
//     judge exists to catch: recall is the share of weak tests it flags, precision
//     the share of its flags that are really weak.
//   - bootstrap: kappa has no simple interval formula, so resample the cases.
import { wilson, type Interval } from '../../flaky-test-analyzer/src/stats.ts';

export const VERDICTS = ['covered', 'partial', 'missing'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const isVerdict = (v: unknown): v is Verdict => typeof v === 'string' && (VERDICTS as readonly string[]).includes(v);

/** confusion[human][judge] = count */
export type Confusion = Record<Verdict, Record<Verdict, number>>;

export function confusion(human: Verdict[], judge: Verdict[]): Confusion {
  if (human.length !== judge.length) throw new RangeError(`${human.length} labels but ${judge.length} verdicts`);
  const m = Object.fromEntries(VERDICTS.map((h) => [h, Object.fromEntries(VERDICTS.map((j) => [j, 0]))])) as Confusion;
  human.forEach((h, i) => {
    m[h][judge[i] as Verdict] += 1;
  });
  return m;
}

export function agreement(human: Verdict[], judge: Verdict[]): { agree: number; n: number; rate: number; ci: Interval } {
  const n = human.length;
  const agree = human.filter((h, i) => h === judge[i]).length;
  return { agree, n, rate: n ? agree / n : 0, ci: wilson(agree, n) };
}

/** Disagreement weight between two verdicts: 0 same, 1 opposite ends. Linear weights. */
export function distance(a: Verdict, b: Verdict, weighted: boolean): number {
  const d = Math.abs(VERDICTS.indexOf(a) - VERDICTS.indexOf(b));
  return weighted ? d / (VERDICTS.length - 1) : d === 0 ? 0 : 1;
}

/**
 * Cohen's kappa = 1 - observed disagreement / disagreement expected by chance.
 * 1 is perfect, 0 is chance level, below 0 is worse than chance. NaN when chance
 * disagreement is 0 (both raters used one verdict only): kappa is undefined there.
 */
export function kappa(human: Verdict[], judge: Verdict[], weighted = false): number {
  const n = human.length;
  if (n === 0 || n !== judge.length) throw new RangeError('need the same, non-zero number of labels and verdicts');
  const m = confusion(human, judge);
  const rowTotal = (h: Verdict) => VERDICTS.reduce((s, j) => s + m[h][j], 0);
  const colTotal = (j: Verdict) => VERDICTS.reduce((s, h) => s + m[h][j], 0);
  let observed = 0;
  let expected = 0;
  for (const h of VERDICTS) {
    for (const j of VERDICTS) {
      const w = distance(h, j, weighted);
      observed += (w * m[h][j]) / n;
      expected += (w * rowTotal(h) * colTotal(j)) / (n * n);
    }
  }
  return expected === 0 ? Number.NaN : 1 - observed / expected;
}

/** Treat partial and missing as "weak": did the judge flag the weak tests? */
export function flagged(human: Verdict[], judge: Verdict[]) {
  const weak = (v: Verdict) => v !== 'covered';
  let tp = 0;
  let fp = 0;
  let fn = 0;
  human.forEach((h, i) => {
    const j = judge[i] as Verdict;
    if (weak(h) && weak(j)) tp += 1;
    else if (!weak(h) && weak(j)) fp += 1;
    else if (weak(h) && !weak(j)) fn += 1;
  });
  return {
    weak: tp + fn,
    caught: tp,
    falseAlarms: fp,
    recall: tp + fn ? tp / (tp + fn) : Number.NaN,
    precision: tp + fp ? tp / (tp + fp) : Number.NaN,
    recallCi: wilson(tp, tp + fn),
  };
}

/** Seeded random numbers (mulberry32), so the bootstrap gives the same interval every run. */
export function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 95% percentile bootstrap interval for kappa, resampling cases. Undefined resamples are skipped. */
export function kappaInterval(human: Verdict[], judge: Verdict[], weighted = false, resamples = 2000, seed = 40): Interval {
  const rand = seeded(seed);
  const n = human.length;
  const values: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const h: Verdict[] = [];
    const j: Verdict[] = [];
    for (let i = 0; i < n; i++) {
      const k = Math.floor(rand() * n);
      h.push(human[k] as Verdict);
      j.push(judge[k] as Verdict);
    }
    const value = kappa(h, j, weighted);
    if (!Number.isNaN(value)) values.push(value);
  }
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))] ?? Number.NaN;
  return { low: at(0.025), high: at(0.975) };
}

/** The most common verdict; ties go to the stricter one (missing > partial > covered). */
export function majority(votes: Verdict[]): Verdict {
  const count = (v: Verdict) => votes.filter((x) => x === v).length;
  return [...VERDICTS].reverse().reduce((best, v) => (count(v) > count(best) ? v : best), 'missing' as Verdict);
}

/** Share of cases where every run gave the same verdict. */
export function unanimous(runs: Verdict[][]): { same: number; n: number } {
  const n = runs[0]?.length ?? 0;
  let same = 0;
  for (let i = 0; i < n; i++) if (new Set(runs.map((r) => r[i])).size === 1) same += 1;
  return { same, n };
}

/** Landis and Koch's words for a kappa value, the scale most papers quote. */
export function describeKappa(k: number): string {
  if (Number.isNaN(k)) return 'undefined';
  if (k < 0) return 'worse than chance';
  if (k <= 0.2) return 'slight';
  if (k <= 0.4) return 'fair';
  if (k <= 0.6) return 'moderate';
  if (k <= 0.8) return 'substantial';
  return 'almost perfect';
}
