import { toCsv } from '../csv.ts';
import type { Suite } from '../types.ts';

export const GENERIC_COLUMNS = ['id', 'section', 'title', 'description', 'expected_result', 'priority', 'type', 'references'];

/** A plain CSV for any other tool or spreadsheet: lower-case headers, quotes only where needed, no byte order mark. */
export function exportGeneric(suite: Suite): string {
  const sectionName = new Map(suite.sections.map((section) => [section.id, section.name]));
  const rows = suite.cases.map((c) => [c.id, sectionName.get(c.section) ?? c.section, c.title, c.description, c.expectedResult, c.priority, c.type, c.references.join(';')]);
  return toCsv([GENERIC_COLUMNS, ...rows], { quoteAll: false, bom: false, eol: '\n' });
}
