import { PRIORITIES, TYPES } from './types.ts';
import type { Issue, PlanDefinition, Suite, TestCase } from './types.ts';

const REQUIRED: (keyof TestCase)[] = ['id', 'section', 'title', 'description', 'expectedResult', 'priority', 'type'];
const TEXT_FIELDS: (keyof TestCase)[] = ['title', 'description', 'expectedResult'];
const ID_FORMAT = /^([A-Z0-9]+)-(\d{3})$/;
const SECTION_ID_FORMAT = /^[A-Z0-9]+$/;
// A spreadsheet reads a cell that starts with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Reports problems in the suite instead of throwing, so one run lists everything,
 * even when the file has the wrong shape (a missing list, a section with no name).
 */
export function validateSuite(suite: Suite): Issue[] {
  const issues: Issue[] = [];
  if (!Array.isArray(suite.sections)) issues.push({ id: 'cases.json', field: 'sections', message: 'sections must be a list' });
  if (!Array.isArray(suite.cases)) issues.push({ id: 'cases.json', field: 'cases', message: 'cases must be a list' });
  if (!Array.isArray(suite.sections) || !Array.isArray(suite.cases)) return issues;

  const sectionIds = new Set<string>();
  const sectionNames = new Set<string>();
  for (const section of suite.sections) {
    const id = isText(section?.id) ? section.id : '(no section ID)';
    if (!isText(section?.id)) issues.push({ id, field: 'sections', message: 'Section has no ID' });
    else if (!SECTION_ID_FORMAT.test(section.id)) issues.push({ id, field: 'sections', message: 'Section ID "' + section.id + '" should be capital letters and digits, like OTC' });
    else if (sectionIds.has(section.id)) issues.push({ id, field: 'sections', message: 'Section ID "' + section.id + '" is repeated' });
    if (isText(section?.id)) sectionIds.add(section.id);
    if (!isText(section?.name)) issues.push({ id, field: 'sections', message: 'Section has no name' });
    else {
      if (sectionNames.has(section.name)) issues.push({ id, field: 'sections', message: 'Section name "' + section.name + '" is repeated' });
      sectionNames.add(section.name);
    }
  }

  const seen = new Set<string>();
  for (const testCase of suite.cases) {
    const id = testCase.id || '(no ID)';
    for (const name of REQUIRED) {
      if (!isText(testCase[name])) issues.push({ id, field: name, message: 'Missing ' + name });
    }
    for (const name of TEXT_FIELDS) {
      const value = testCase[name];
      if (typeof value === 'string' && FORMULA_START.test(value)) {
        issues.push({ id, field: name, message: name + ' starts with "' + value.charAt(0) + '", which a spreadsheet reads as a formula' });
      }
    }
    if (testCase.id) {
      if (seen.has(testCase.id)) issues.push({ id, field: 'id', message: 'ID "' + testCase.id + '" is repeated' });
      seen.add(testCase.id);
      const match = ID_FORMAT.exec(testCase.id);
      if (!match) issues.push({ id, field: 'id', message: 'ID "' + testCase.id + '" should look like OTC-001' });
      else if (testCase.section && match[1] !== testCase.section) {
        issues.push({ id, field: 'id', message: 'ID prefix "' + match[1] + '" does not match section "' + testCase.section + '"' });
      }
    }
    if (testCase.section && !sectionIds.has(testCase.section)) issues.push({ id, field: 'section', message: 'Unknown section "' + testCase.section + '"' });
    if (testCase.priority && !(PRIORITIES as readonly string[]).includes(testCase.priority)) {
      issues.push({ id, field: 'priority', message: 'Unknown priority "' + testCase.priority + '" (use ' + PRIORITIES.join(', ') + ')' });
    }
    if (testCase.type && !(TYPES as readonly string[]).includes(testCase.type)) {
      issues.push({ id, field: 'type', message: 'Unknown type "' + testCase.type + '" (use ' + TYPES.join(', ') + ')' });
    }
    if (!Array.isArray(testCase.references) || !testCase.references.every((reference) => isText(reference))) {
      issues.push({ id, field: 'references', message: 'References must be a list of non-empty text' });
    }
  }
  return issues;
}

/** Checks a plan definition against the suite: known filter keys and values, unique run names, and every run selects something. */
export function validatePlan(definition: PlanDefinition, suite: Suite): Issue[] {
  const issues: Issue[] = [];
  if (!Array.isArray(definition.runs)) return [{ id: 'plan.json', field: 'runs', message: 'runs must be a list' }];
  const known: Record<string, readonly string[]> = {
    section: Array.isArray(suite.sections) ? suite.sections.map((section) => section.id) : [],
    priority: PRIORITIES,
    type: TYPES,
  };
  const names = new Set<string>();
  for (const run of definition.runs) {
    const id = isText(run?.name) ? run.name : '(no run name)';
    if (!isText(run?.name)) issues.push({ id, field: 'name', message: 'Run has no name' });
    else {
      if (names.has(run.name)) issues.push({ id, field: 'name', message: 'Run name "' + run.name + '" is repeated' });
      names.add(run.name);
    }
    if (typeof run?.where !== 'object' || run.where === null || Array.isArray(run.where)) {
      issues.push({ id, field: 'where', message: 'Run "' + id + '" needs a where filter' });
      continue;
    }
    let filterProblems = 0;
    for (const [key, values] of Object.entries(run.where)) {
      const allowed = known[key];
      if (!allowed) {
        issues.push({ id, field: key, message: 'Unknown filter "' + key + '"' });
        filterProblems++;
      } else if (!Array.isArray(values) || values.length === 0) {
        issues.push({ id, field: key, message: 'Filter "' + key + '" must be a list with at least one value' });
        filterProblems++;
      } else {
        for (const value of values) {
          if (!allowed.includes(value)) {
            issues.push({ id, field: key, message: 'Unknown ' + key + ' "' + value + '"' });
            filterProblems++;
          }
        }
      }
    }
    // Only when the filter itself is well formed; otherwise the problem above is the cause.
    if (filterProblems === 0 && Array.isArray(suite.cases)) {
      const selected = suite.cases.some((testCase) =>
        Object.entries(run.where).every(([key, values]) => values.includes(testCase[key as 'section' | 'priority' | 'type'])),
      );
      if (!selected) issues.push({ id, field: 'where', message: 'Run "' + id + '" selects no cases' });
    }
  }
  return issues;
}
