// The sheet a person used to confirm or change each draft label.
//
// node src/review-sheet.ts          writes labels/review-sheet.md (draft labels, "Your label: agree")
// node src/review-sheet.ts --read   prints every line the reviewer changed
//
// Each entry shows the criterion and the test written for it (the n-th test in the
// spec answers the n-th criterion), so the reviewer doesn't need to open the specs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lf, type KeyEntry } from './build-cases.ts';
import { loadItems, PKG } from './render.ts';

const SHEET = path.join(PKG, 'labels', 'review-sheet.md');

export function testBlocks(spec: string): string[] {
  const lines = lf(spec).split('\n');
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^ {2}test(\.(skip|only|fixme))?\(/.test(line)) current = [];
    if (current) {
      current.push(line);
      if (line === '  });') {
        blocks.push(current.join('\n'));
        current = null;
      }
    }
  }
  return blocks;
}

export function setup(spec: string): string {
  const m = /^ {2}test\.beforeEach\([\s\S]*?\n {2}\}\);$/m.exec(lf(spec));
  return m ? m[0] : '';
}

export function loadKey(): Record<string, KeyEntry> {
  return JSON.parse(fs.readFileSync(path.join(PKG, 'labels', 'key.json'), 'utf8')) as Record<string, KeyEntry>;
}

export function readAnswers(sheet: string): Map<string, string> {
  const answers = new Map<string, string>();
  let id = '';
  for (const line of lf(sheet).split('\n')) {
    const head = /^### (J\d+)/.exec(line);
    if (head) id = head[1] ?? '';
    const answer = /^Your label: *(.*)$/.exec(line);
    if (answer && id) answers.set(id, (answer[1] ?? '').trim().toLowerCase());
  }
  return answers;
}

function write(append: boolean): void {
  const key = loadKey();
  const items = loadItems();
  const order = [...items].sort((a, b) => {
    const ka = key[a.id] as KeyEntry;
    const kb = key[b.id] as KeyEntry;
    return ka.feature.localeCompare(kb.feature) || ka.criterion.localeCompare(kb.criterion) || (ka.variant ?? '').localeCompare(kb.variant ?? '');
  });
  // --append: add only cases the sheet doesn't have yet, after the reviewer's edits
  const existing = append ? readAnswers(fs.readFileSync(SHEET, 'utf8')) : new Map<string, string>();
  const todo = order.filter((item) => !existing.has(item.id));
  const out: string[] = append
    ? ['', '## Round 2: subtler variants (added later)', '']
    : [
    '# Label review',
    '',
    'For each case: read the criterion and the test, then the draft label. If you agree, leave `Your label: agree`. If not, replace `agree` with `covered`, `partial` or `missing` (a short reason after it is welcome, e.g. `partial: names only`).',
    '',
    '- **covered**: the test does the action and asserts the outcome the criterion names. One example is enough when the criterion describes one.',
    '- **partial**: it asserts only part of that outcome, or only some of the cases the criterion names.',
    '- **missing**: no test that runs asserts it, or the only assertion would pass whether or not it happened.',
    '',
    '"Variant" cases are the same spec with one test changed on purpose. Judge only what the code checks.',
    '',
  ];
  let feature = '';
  for (const item of todo) {
    const k = key[item.id] as KeyEntry;
    if (append) {
      out.push(`*Feature: ${k.feature}*`, '');
    } else if (k.feature !== feature) {
      feature = k.feature;
      out.push(`## ${feature}`, '');
    }
    const n = Number(k.criterion.slice(1));
    const spec = fs.readFileSync(path.join(PKG, 'cases', item.spec), 'utf8');
    const block = [setup(spec), testBlocks(spec)[n - 1] ?? '(no test)'].filter(Boolean).join('\n\n');
    out.push(
      `### ${item.id} · ${k.criterion}${k.variant ? ` · variant ${k.variant}` : ''}`,
      '',
      `**Criterion:** ${item.criterion}`,
      '',
      '```js',
      block,
      '```',
      '',
      `**Draft:** ${k.label}. ${k.reason}`,
      ...(k.borderline ? ['', `**Borderline:** ${k.borderline}`] : []),
      '',
      'Your label: agree',
      '',
    );
  }
  if (append) fs.appendFileSync(SHEET, out.join('\n'));
  else fs.writeFileSync(SHEET, out.join('\n'));
  console.log(`${append ? 'appended' : 'wrote'} ${todo.length} cases to ${SHEET}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--read')) {
    const answers = readAnswers(fs.readFileSync(SHEET, 'utf8'));
    const changed = [...answers].filter(([, a]) => !/^agree\b/.test(a));
    console.log(`${answers.size} answers, ${changed.length} changed`);
    for (const [id, a] of changed) console.log(`${id}: ${a}`);
  } else {
    write(process.argv.includes('--append'));
  }
}
