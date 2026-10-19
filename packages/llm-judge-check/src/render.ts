// Renders the judge prompt for one case: judge/prompt.md with {{feature}},
// {{criterion}} and {{spec}} filled in. The recorded runs store the SHA-256 of each
// rendered prompt, so a test can prove the judges saw exactly these prompts.
//
// node src/render.ts <out-dir> [v1|v2]   writes <out-dir>/J01.md ... for a judge session
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lf, type Item } from './build-cases.ts';

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadItems(): Item[] {
  return JSON.parse(fs.readFileSync(path.join(PKG, 'cases', 'items.json'), 'utf8')) as Item[];
}

// v1: the first rubric. v2: rewritten from the reviewer's rules after labelling.
export const RUBRICS = { v1: 'prompt.md', v2: 'prompt-v2.md' } as const;
export type Rubric = keyof typeof RUBRICS;

export function template(rubric: Rubric = 'v1'): string {
  return lf(fs.readFileSync(path.join(PKG, 'judge', RUBRICS[rubric]), 'utf8'));
}

export function vars(item: Item): { feature: string; criterion: string; spec: string } {
  const read = (rel: string) => lf(fs.readFileSync(path.join(PKG, 'cases', rel), 'utf8')).trimEnd();
  return { feature: read(item.feature), criterion: item.criterion, spec: read(item.spec) };
}

export function fill(tpl: string, v: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => v[name] ?? whole);
}

export function render(item: Item, tpl = template()): string {
  return fill(tpl, vars(item));
}

export const sha256 = (s: string): string => crypto.createHash('sha256').update(lf(s)).digest('hex');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, rubric = 'v1'] = process.argv.slice(2);
  if (!out || !(rubric in RUBRICS)) throw new Error('usage: node src/render.ts <out-dir> [v1|v2]');
  fs.mkdirSync(out, { recursive: true });
  const tpl = template(rubric as Rubric);
  for (const item of loadItems()) fs.writeFileSync(path.join(out, `${item.id}.md`), render(item, tpl));
  console.log(`wrote ${loadItems().length} prompts to ${out}`);
}
