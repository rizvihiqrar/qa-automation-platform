import { coverage } from '../coverage.ts';
import type { Plan, Suite } from '../types.ts';

// Backslashes first, so a title ending in one cannot escape the pipe after it.
const cell = (text: string) => text.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');

/** A report that needs no tool: counts, the runs, then every case by section. */
export function exportMarkdown(suite: Suite, plan: Plan): string {
  const counts = coverage(suite);
  const lines: string[] = ['# ' + suite.suite + ' test suite', '', counts.total + ' cases in ' + suite.sections.length + ' sections.', ''];

  lines.push('## Coverage', '', '| Section | Cases |', '|---|---:|');
  for (const [name, n] of Object.entries(counts.bySection)) lines.push('| ' + cell(name) + ' | ' + n + ' |');
  lines.push('', '| Priority | Cases |', '|---|---:|');
  for (const [name, n] of Object.entries(counts.byPriority)) lines.push('| ' + name + ' | ' + n + ' |');
  lines.push('', '| Type | Cases |', '|---|---:|');
  for (const [name, n] of Object.entries(counts.byType)) lines.push('| ' + name + ' | ' + n + ' |');

  lines.push('', '## Test plan: ' + plan.name, '', '| Run | Cases | Purpose |', '|---|---:|---|');
  for (const run of plan.runs) lines.push('| ' + cell(run.name) + ' | ' + run.caseIds.length + ' | ' + cell(run.description) + ' |');

  lines.push('', '## Cases');
  for (const section of suite.sections) {
    lines.push('', '### ' + cell(section.name), '', '| ID | Title | Priority | Type | Expected result |', '|---|---|---|---|---|');
    for (const c of suite.cases.filter((testCase) => testCase.section === section.id)) {
      lines.push('| ' + c.id + ' | ' + cell(c.title) + ' | ' + c.priority + ' | ' + c.type + ' | ' + cell(c.expectedResult) + ' |');
    }
  }
  return lines.join('\n') + '\n';
}
