// Does an answer's cited test exist in the spec of the case it was filed under?
//
// The rubric asks for the title of the test the judge used. A title that isn't in
// that case's spec means the judge described a test that isn't there, or (as found
// in two Day 40 sessions) wrote its answer for one case under another case's ID.
// Recording can't catch the second: every ID is valid and every verdict is a verdict.
import fs from 'node:fs';
import path from 'node:path';
import { lf, type Item } from './build-cases.ts';
import { PKG } from './render.ts';

/** Titles of every test in a spec: test(...), test.skip(...), test.only(...), test.fixme(...). */
export function testTitles(spec: string): string[] {
  const re = /\btest(?:\.(?:skip|only|fixme|fail))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  return [...spec.matchAll(re)].map((m) => (m[2] as string).replace(/\\(.)/g, '$1'));
}

// Judges often drop the @smoke/@regression tags or shorten a title; that still names the test.
const norm = (t: string) => t.replace(/@[\w-]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** How a cited title relates to one spec's tests. */
export function cite(spec: string, title: string | null): 'none' | 'exact' | 'loose' | 'absent' {
  if (title === null) return 'none';
  const titles = testTitles(spec);
  if (titles.includes(title)) return 'exact';
  const n = norm(title);
  if (n.length >= 10 && titles.some((t) => norm(t) === n || norm(t).includes(n))) return 'loose';
  return 'absent';
}

export interface Citation {
  run: string;
  id: string;
  test: string;
  /** another case's spec has this test: the answer was filed under the wrong case */
  kind: 'elsewhere' | 'invented';
  foundIn: string[];
}

/** Every answer in the given runs whose cited test is not a test in its own case's spec. */
export function badCitations(
  runs: { name: string; answers: { id: string; test: string | null }[] }[],
  items: Item[],
  specOf: (item: Item) => string = (item) => lf(fs.readFileSync(path.join(PKG, 'cases', item.spec), 'utf8')),
): Citation[] {
  const specs = new Map(items.map((i) => [i.id, specOf(i)]));
  const out: Citation[] = [];
  for (const run of runs) {
    for (const a of run.answers) {
      if (cite(specs.get(a.id) ?? '', a.test) !== 'absent') continue;
      const foundIn = items.filter((i) => i.id !== a.id && cite(specs.get(i.id) ?? '', a.test) !== 'absent').map((i) => i.id);
      out.push({ run: run.name, id: a.id, test: a.test as string, kind: foundIn.length ? 'elsewhere' : 'invented', foundIn });
    }
  }
  return out;
}
