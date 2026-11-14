import { DRILL } from './selectors.ts';
import { share, STYLES, type Result } from './drill.ts';
import { VARIANTS } from './variants.ts';

// The rules the numbers argue for. Kept here so the report and the README say the same.
export const RULES = [
  'Use an attribute that says what the element is: a label (aria-label), a name, a type, an href, a data-testid. Those change when the meaning changes, not when the layout does.',
  'Never use class names. A restyle, a framework upgrade or a build that hashes them renames every one.',
  'Never count position (nth-child, a[3], div[5]). Sorting, a new banner or a moved field changes every position.',
  'Never chain direct children (a > b > c) to reach an element. One new wrapper breaks the chain; a descendant (a b) or no ancestor at all survives.',
  'Never copy the path a recorder wrote. It is all positions.',
  'Check that it matches exactly one element. A selector that finds two is as broken as one that finds none.',
];

export function renderReport(results: Result[]): string {
  const at = (variant: string, style: string) => results.find((r) => r.variant === variant && r.style === style) as Result;
  const lines = [
    '# Selector drill',
    '',
    `${DRILL.length} elements, found three ways, on the page before and after four layout changes. A selector counts as surviving only if it finds exactly one element and it is the right one.`,
    '',
    `| Layout change | ${STYLES.join(' | ')} |`,
    `|---|${STYLES.map(() => '---:').join('|')}|`,
    ...(['before', ...VARIANTS] as const).map((v) => `| ${v} | ${STYLES.map((s) => `${share(at(v, s))}%`).join(' | ')} |`),
    '',
    '## What broke',
    '',
  ];
  for (const style of STYLES) {
    for (const v of VARIANTS) {
      const r = at(v, style);
      if (r.broke.length) lines.push(`- **${style}, ${v}** (${r.broke.length}): ${r.broke.join(', ')}`);
    }
  }
  lines.push('', '## Rules', '', ...RULES.map((r, i) => `${i + 1}. ${r}`), '');
  return lines.join('\n');
}
