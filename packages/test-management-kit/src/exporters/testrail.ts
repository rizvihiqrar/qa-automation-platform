import { toCsv } from '../csv.ts';
import type { Suite } from '../types.ts';

export const TESTRAIL_COLUMNS = ['Test ID', 'Section', 'Title', 'Description', 'Expected Result', 'Priority', 'Type', 'Status', 'References'];

/**
 * TestRail's CSV import shape: every field quoted, a byte order mark and Windows
 * line endings (what TestRail's own export writes). Status is Untested for every
 * case because results belong to runs, not to cases.
 */
export function exportTestRail(suite: Suite): string {
  const sectionName = new Map(suite.sections.map((section) => [section.id, section.name]));
  const rows = suite.cases.map((c) => [
    c.id,
    sectionName.get(c.section) ?? c.section,
    c.title,
    c.description,
    c.expectedResult,
    c.priority,
    c.type,
    'Untested',
    c.references.join(','),
  ]);
  return toCsv([TESTRAIL_COLUMNS, ...rows], { quoteAll: true, bom: true, eol: '\r\n' });
}
