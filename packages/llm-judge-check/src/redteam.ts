// Builds the red-team cases from labels/redteam.ts, the same way build-cases.ts
// builds the Day 40 ones: blind, shuffled with a fixed seed, labels kept apart.
//   redteam/cases/items.json            id, feature file, spec file, criterion (no labels)
//   redteam/cases/specs/rt-NN.spec.js   the edited specs
//   labels/redteam-key.json             id -> attack, label, what it pushes for
// The prompt is the Day 40 rubric v2 unchanged.
//
// node src/redteam.ts build            writes the files
// node src/redteam.ts build --check    fails if the committed files differ (CI)
// node src/redteam.ts render <dir>     writes <dir>/R01.md ... for a judge session
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RED_TEAM, type Attack, type Category } from '../labels/redteam.ts';
import type { Verdict } from '../labels/source.ts';
import { applyVariant, lf, random, shuffle, type Item } from './build-cases.ts';
import { fill, loadItems, PKG, template } from './render.ts';

const SEED = 41;
export const RUBRIC = 'v2';

export interface RedKey {
  key: string;
  category: Category;
  name: string;
  base: string;
  label: Verdict;
  push: Verdict | null;
  forbidden: string | null; // RegExp source, flags after the last slash
  why: string;
}

const read = (rel: string) => lf(fs.readFileSync(path.join(PKG, rel), 'utf8'));

export function build(attacks: Attack[] = RED_TEAM): { files: Map<string, string>; items: Item[]; key: Record<string, RedKey> } {
  const day40 = new Map(loadItems().map((i) => [i.id, i]));
  const keys = new Set<string>();
  const made = attacks.map((a) => {
    if (keys.has(a.key)) throw new Error(`${a.key}: used twice`);
    keys.add(a.key);
    const base = day40.get(a.base);
    const from = day40.get(a.specFrom ?? a.base);
    if (!base || !from) throw new Error(`${a.key}: no Day 40 case ${a.specFrom ?? a.base}`);
    let spec = read(`cases/${from.spec}`);
    for (const e of a.edits) spec = applyVariant(spec, e.find, e.replace, a.key);
    if (a.edits.length && spec === read(`cases/${from.spec}`)) throw new Error(`${a.key}: the edits change nothing`);
    return { a, spec, feature: `cases/${base.feature}`, criterion: base.criterion };
  });

  const rand = random(SEED);
  const files = new Map<string, string>();
  const items: Item[] = [];
  const key: Record<string, RedKey> = {};
  shuffle(made, rand).forEach((m, i) => {
    const n = String(i + 1).padStart(2, '0');
    const spec = `redteam/cases/specs/rt-${n}.spec.js`;
    files.set(spec, m.spec);
    items.push({ id: `R${n}`, feature: m.feature, spec, criterion: m.criterion });
    key[`R${n}`] = {
      key: m.a.key, category: m.a.category, name: m.a.name, base: m.a.base, label: m.a.label,
      push: m.a.push ?? null, forbidden: m.a.forbidden ? String(m.a.forbidden) : null, why: m.a.why,
    };
  });
  files.set('redteam/cases/items.json', JSON.stringify(items, null, 2) + '\n');
  files.set('labels/redteam-key.json', JSON.stringify(key, null, 2) + '\n');
  return { files, items, key };
}

export function loadRedItems(): Item[] {
  return JSON.parse(read('redteam/cases/items.json')) as Item[];
}

export function loadRedKey(): Record<string, RedKey> {
  return JSON.parse(read('labels/redteam-key.json')) as Record<string, RedKey>;
}

export const forbiddenRe = (k: RedKey): RegExp | null => {
  if (!k.forbidden) return null;
  const m = /^\/(.*)\/(\w*)$/s.exec(k.forbidden);
  return m ? new RegExp(m[1] as string, m[2]) : null;
};

/** Red-team item paths are relative to the package (Day 40's are relative to cases/). */
export function renderRed(item: Item, tpl = template(RUBRIC)): string {
  return fill(tpl, { feature: read(item.feature).trimEnd(), criterion: item.criterion, spec: read(item.spec).trimEnd() });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'build') {
    const { files } = build();
    if (process.argv.includes('--check')) {
      const stale = [...files].filter(([rel, content]) => !fs.existsSync(path.join(PKG, rel)) || read(rel) !== content);
      if (stale.length) {
        console.error(`Out of date (run node src/redteam.ts build):\n  ${stale.map(([rel]) => rel).join('\n  ')}`);
        process.exit(1);
      }
      console.log(`${files.size} red-team case files up to date`);
    } else {
      fs.rmSync(path.join(PKG, 'redteam', 'cases'), { recursive: true, force: true });
      for (const [rel, content] of files) {
        fs.mkdirSync(path.dirname(path.join(PKG, rel)), { recursive: true });
        fs.writeFileSync(path.join(PKG, rel), content);
      }
      console.log(`wrote ${files.size} files`);
    }
  } else if (cmd === 'render' && arg) {
    fs.mkdirSync(arg, { recursive: true });
    const items = loadRedItems();
    for (const item of items) fs.writeFileSync(path.join(arg, `${item.id}.md`), renderRed(item));
    console.log(`wrote ${items.length} prompts to ${arg}`);
  } else {
    throw new Error('usage: node src/redteam.ts build [--check] | render <out-dir>');
  }
}
