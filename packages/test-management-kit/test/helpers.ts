import type { Suite, TestCase } from '../src/types.ts';

export function makeCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'AAA-001',
    section: 'AAA',
    title: 'A title',
    description: 'A description',
    expectedResult: 'An expected result',
    priority: 'High',
    type: 'Regression',
    references: [],
    ...overrides,
  };
}

/** Two sections and four cases, enough to show every filter and count. */
export function makeSuite(): Suite {
  return {
    suite: 'Sample',
    sections: [
      { id: 'AAA', name: 'First section' },
      { id: 'BBB', name: 'Second section' },
    ],
    cases: [
      makeCase({ id: 'AAA-001', priority: 'High', type: 'Regression' }),
      makeCase({ id: 'AAA-002', priority: 'Medium', type: 'Integration' }),
      makeCase({ id: 'BBB-001', section: 'BBB', priority: 'High', type: 'Security' }),
      makeCase({ id: 'BBB-002', section: 'BBB', priority: 'Medium', type: 'Negative' }),
    ],
  };
}
