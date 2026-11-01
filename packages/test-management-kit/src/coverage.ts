import { PRIORITIES, TYPES } from './types.ts';
import type { Suite } from './types.ts';

export interface Coverage {
  total: number;
  bySection: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
}

function count(keys: readonly string[], values: string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** Cases per section, priority and type. Known values with no cases show as 0. */
export function coverage(suite: Suite): Coverage {
  const sectionName = new Map(suite.sections.map((section) => [section.id, section.name]));
  return {
    total: suite.cases.length,
    bySection: count(
      suite.sections.map((section) => section.name),
      suite.cases.map((testCase) => sectionName.get(testCase.section) ?? testCase.section),
    ),
    byPriority: count(PRIORITIES, suite.cases.map((testCase) => testCase.priority)),
    byType: count(TYPES, suite.cases.map((testCase) => testCase.type)),
  };
}

export function formatCoverage(result: Coverage): string {
  const block = (title: string, counts: Record<string, number>) => {
    const width = Math.max(...Object.keys(counts).map((key) => key.length));
    return [title, ...Object.entries(counts).map(([key, n]) => '  ' + key.padEnd(width) + '  ' + String(n).padStart(3))].join('\n');
  };
  return ['Cases: ' + result.total, block('By section', result.bySection), block('By priority', result.byPriority), block('By type', result.byType)].join('\n\n') + '\n';
}
