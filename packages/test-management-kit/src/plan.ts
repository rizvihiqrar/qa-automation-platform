import type { Plan, PlanDefinition, RunFilter, Suite, TestCase } from './types.ts';

function matches(testCase: TestCase, where: RunFilter): boolean {
  return (
    (!where.section || where.section.includes(testCase.section)) &&
    (!where.priority || where.priority.includes(testCase.priority)) &&
    (!where.type || where.type.includes(testCase.type))
  );
}

/**
 * The test plan: one run per section (so one tester can own a cycle), then the
 * runs defined in plan.json (smoke, integration, security).
 */
export function buildPlan(suite: Suite, definition: PlanDefinition): Plan {
  const perSection = suite.sections.map((section) => ({
    name: section.name,
    description: 'Every case in ' + section.name,
    caseIds: suite.cases.filter((testCase) => testCase.section === section.id).map((testCase) => testCase.id),
  }));
  const defined = definition.runs.map((run) => ({
    name: run.name,
    description: run.description ?? '',
    caseIds: suite.cases.filter((testCase) => matches(testCase, run.where)).map((testCase) => testCase.id),
  }));
  return { name: definition.name, runs: [...perSection, ...defined] };
}
