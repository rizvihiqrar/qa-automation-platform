// Builds the blind judge cases from labels/source.ts:
//   cases/items.json        id, feature file, spec file, criterion (no labels)
//   cases/features/*.txt    the ten feature files
//   cases/specs/spec-NN.spec.js  the ten unedited specs and the 16 variants, shuffled
//   labels/key.json         id -> label, reason, where it came from
// Names and order are shuffled with a fixed seed, so a judge can't tell a variant
// from a real case by its name, and the output is the same on every run.
//
// node src/build-cases.ts          writes the files
// node src/build-cases.ts --check  fails if the committed files differ (used in CI)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARD, REAL, VARIANTS, type Verdict } from '../labels/source.ts';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.resolve(PKG, '..', 'ai-test-generator');
const RUN = path.join(GEN, 'eval', 'runs', 'claude-code-2026-10-16');
const SEED = 40;

export interface Item {
  id: string;
  feature: string; // relative to cases/
  spec: string; // relative to cases/
  criterion: string;
}

export interface KeyEntry {
  label: Verdict; // the reviewer's label
  draft: Verdict; // the label as first drafted, before review
  reason: string;
  borderline: string | null;
  kind: 'real' | 'variant';
  feature: string;
  criterion: string; // C1, C2, ...
  variant: string | null;
  round: 1 | 2;
}

export const lf = (s: string): string => s.replace(/\r\n/g, '\n');

export function criteriaOf(featureText: string): string[] {
  const after = lf(featureText).split('Acceptance Criteria:')[1] ?? '';
  return after.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
}

// mulberry32: small, seeded, good enough for shuffling
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function applyVariant(spec: string, find: string, replace: string, key: string): string {
  const count = spec.split(find).length - 1;
  if (count !== 1) throw new Error(`${key}: "find" occurs ${count} times in the base spec, expected 1`);
  return spec.replace(find, () => replace);
}

export interface Built {
  files: Map<string, string>; // path relative to the package -> content (LF)
  items: Item[];
  key: Record<string, KeyEntry>;
}

export function build(): Built {
  const features = [...new Set(REAL.map((r) => r.feature))];
  const featureText = new Map<string, string>();
  const specText = new Map<string, string>();
  for (const f of features) {
    featureText.set(f, lf(fs.readFileSync(path.join(GEN, 'examples', 'input', `feature-${f}.txt`), 'utf8')));
    specText.set(f, lf(fs.readFileSync(path.join(RUN, `feature-${f}.spec.js`), 'utf8')));
  }

  // every criterion in every feature file has exactly one label
  for (const f of features) {
    const n = criteriaOf(featureText.get(f) ?? '').length;
    const labelled = REAL.filter((r) => r.feature === f).map((r) => r.c).sort((a, b) => a - b);
    if (labelled.join() !== Array.from({ length: n }, (_, i) => i + 1).join()) {
      throw new Error(`${f}: labels for criteria ${labelled.join()} but the file has ${n}`);
    }
  }

  // one spec per real feature, one per variant
  const specs: { content: string; origin: string }[] = features.map((f) => ({ content: specText.get(f) ?? '', origin: f }));
  for (const v of VARIANTS) {
    specs.push({ content: applyVariant(specText.get(v.feature) ?? '', v.find, v.replace, v.key), origin: v.key });
  }
  const rand = random(SEED);
  const specName = new Map<string, string>();
  shuffle(specs, rand).forEach((s, i) => specName.set(s.origin, `specs/spec-${String(i + 1).padStart(2, '0')}.spec.js`));

  type Case = { item: Omit<Item, 'id'>; key: Omit<KeyEntry, 'round'> };
  const cases: Case[] = [];
  for (const r of REAL) {
    const criterion = criteriaOf(featureText.get(r.feature) ?? '')[r.c - 1] ?? '';
    cases.push({
      item: { feature: `features/${r.feature}.txt`, spec: specName.get(r.feature) ?? '', criterion },
      key: { label: r.label, draft: r.draft ?? r.label, reason: r.reason, borderline: r.borderline ?? null, kind: 'real', feature: r.feature, criterion: `C${r.c}`, variant: null },
    });
  }
  for (const v of VARIANTS) {
    const criterion = criteriaOf(featureText.get(v.feature) ?? '')[v.c - 1] ?? '';
    cases.push({
      item: { feature: `features/${v.feature}.txt`, spec: specName.get(v.key) ?? '', criterion },
      key: { label: v.label, draft: v.draft ?? v.label, reason: v.reason, borderline: v.borderline ?? null, kind: 'variant', feature: v.feature, criterion: `C${v.c}`, variant: v.key },
    });
  }

  const items: Item[] = [];
  const key: Record<string, KeyEntry> = {};
  const add = (list: Case[], round: 1 | 2) =>
    shuffle(list, rand).forEach((c) => {
      const id = `J${String(items.length + 1).padStart(2, '0')}`;
      items.push({ id, ...c.item });
      key[id] = { ...c.key, round };
    });
  add(cases, 1);

  // Round 2 comes after round 1 in every sequence (spec numbers, case IDs, random
  // draws), so adding it left round 1's files and IDs exactly as the judges saw them.
  const hardSpecs = HARD.map((v) => ({ content: applyVariant(specText.get(v.feature) ?? '', v.find, v.replace, v.key), origin: v.key }));
  shuffle(hardSpecs, rand).forEach((s, i) => specName.set(s.origin, `specs/spec-${String(specs.length + i + 1).padStart(2, '0')}.spec.js`));
  specs.push(...hardSpecs);
  add(
    HARD.map((v) => ({
      item: { feature: `features/${v.feature}.txt`, spec: specName.get(v.key) ?? '', criterion: criteriaOf(featureText.get(v.feature) ?? '')[v.c - 1] ?? '' },
      key: { label: v.label, draft: v.draft ?? v.label, reason: v.reason, borderline: v.borderline ?? null, kind: 'variant', feature: v.feature, criterion: `C${v.c}`, variant: v.key },
    })),
    2,
  );

  const files = new Map<string, string>();
  for (const f of features) files.set(`cases/features/${f}.txt`, featureText.get(f) ?? '');
  for (const s of specs) files.set(`cases/${specName.get(s.origin)}`, s.content);
  files.set('cases/items.json', JSON.stringify(items, null, 2) + '\n');
  files.set('labels/key.json', JSON.stringify(key, null, 2) + '\n');
  return { files, items, key };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files } = build();
  if (process.argv.includes('--check')) {
    const stale = [...files].filter(([rel, content]) => {
      const file = path.join(PKG, rel);
      return !fs.existsSync(file) || lf(fs.readFileSync(file, 'utf8')) !== content;
    });
    if (stale.length) {
      console.error(`Out of date (run npm run build-cases):\n  ${stale.map(([rel]) => rel).join('\n  ')}`);
      process.exit(1);
    }
    console.log(`${files.size} case files up to date`);
  } else {
    fs.rmSync(path.join(PKG, 'cases'), { recursive: true, force: true });
    for (const [rel, content] of files) {
      fs.mkdirSync(path.dirname(path.join(PKG, rel)), { recursive: true });
      fs.writeFileSync(path.join(PKG, rel), content);
    }
    console.log(`wrote ${files.size} files`);
  }
}
