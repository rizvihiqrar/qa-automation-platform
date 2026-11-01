export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const TYPES = ['Regression', 'Integration', 'Negative', 'Security'] as const;

export interface Section {
  id: string;
  name: string;
}

export interface TestCase {
  id: string;
  section: string;
  title: string;
  description: string;
  expectedResult: string;
  priority: string;
  type: string;
  references: string[];
}

export interface Suite {
  suite: string;
  sections: Section[];
  cases: TestCase[];
}

export interface RunFilter {
  section?: string[];
  priority?: string[];
  type?: string[];
}

export interface RunDefinition {
  name: string;
  description?: string;
  where: RunFilter;
}

export interface PlanDefinition {
  name: string;
  runs: RunDefinition[];
}

export interface Run {
  name: string;
  description: string;
  caseIds: string[];
}

export interface Plan {
  name: string;
  runs: Run[];
}

export interface Issue {
  id: string;
  field: string;
  message: string;
}
