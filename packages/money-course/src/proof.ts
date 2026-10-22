import { CHECKS } from './model-answer.ts';
import { BUGS, startVariant } from './plant.ts';

// npm run proof: the model answer against the real banking API, then against a copy with
// each bug planted alone, printing what each check saw. test/model-answer.test.ts asserts
// the same thing; this shows it.
const rows: string[] = ['| Banking API | O1 | O2 | O3 | O4 | O5 | O6 |', '|---|---|---|---|---|---|---|'];
const variants: [string, string[]][] = [['unchanged', []], ...BUGS.map((b): [string, string[]] => [`bug ${b.id} planted`, [b.id]]), ['all six planted', BUGS.map((b) => b.id)]];
const quiet = console.error;
console.error = () => {}; // the planted O6 bug makes the API log its 500
for (const [label, ids] of variants) {
  const variant = await startVariant(ids);
  const cells: string[] = [];
  for (const check of CHECKS) cells.push((await check.run(variant.base)).ok ? 'pass' : '**FAIL**');
  await variant.stop();
  rows.push(`| ${label} | ${cells.join(' | ')} |`);
}
console.error = quiet;
console.log(rows.join('\n'));
