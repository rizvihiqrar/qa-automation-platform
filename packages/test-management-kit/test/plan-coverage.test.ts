import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, formatCoverage } from '../src/coverage.ts';
import { buildPlan } from '../src/plan.ts';
import { makeCase, makeSuite } from './helpers.ts';

const definition = {
  name: 'Release candidate',
  runs: [
    { name: 'Smoke', description: 'High only', where: { priority: ['High'] } },
    { name: 'Integration', where: { type: ['Integration'] } },
    { name: 'Security', where: { type: ['Security', 'Negative'] } },
    { name: 'High and second section', where: { priority: ['High'], section: ['BBB'] } },
  ],
};

test('the plan has one run per section, then the defined runs', () => {
  const plan = buildPlan(makeSuite(), definition);
  assert.deepEqual(plan.runs.map((run) => run.name), ['First section', 'Second section', 'Smoke', 'Integration', 'Security', 'High and second section']);
});

test('a section run holds exactly that section\'s cases', () => {
  const plan = buildPlan(makeSuite(), definition);
  assert.deepEqual(plan.runs[0]?.caseIds, ['AAA-001', 'AAA-002']);
  assert.deepEqual(plan.runs[1]?.caseIds, ['BBB-001', 'BBB-002']);
});

test('a filter keeps only matching cases, and a list inside a filter means any of', () => {
  const runs = buildPlan(makeSuite(), definition).runs;
  assert.deepEqual(runs.find((r) => r.name === 'Smoke')?.caseIds, ['AAA-001', 'BBB-001']);
  assert.deepEqual(runs.find((r) => r.name === 'Security')?.caseIds, ['BBB-001', 'BBB-002']);
});

test('two filters in one run must both match', () => {
  assert.deepEqual(buildPlan(makeSuite(), definition).runs.at(-1)?.caseIds, ['BBB-001']);
});

test('a run without a description gets an empty one', () => {
  assert.equal(buildPlan(makeSuite(), definition).runs.find((r) => r.name === 'Integration')?.description, '');
});

test('coverage counts cases per section, priority and type', () => {
  assert.deepEqual(coverage(makeSuite()), {
    total: 4,
    bySection: { 'First section': 2, 'Second section': 2 },
    byPriority: { Critical: 0, High: 2, Medium: 2, Low: 0 },
    byType: { Regression: 1, Integration: 1, Negative: 1, Security: 1 },
  });
});

test('coverage shows a known value with no cases as 0, and a section with no cases too', () => {
  const suite = makeSuite();
  suite.sections.push({ id: 'CCC', name: 'Empty section' });
  suite.cases = [makeCase()];
  const result = coverage(suite);
  assert.equal(result.bySection['Empty section'], 0);
  assert.equal(result.byType.Security, 0);
});

test('coverage of a suite with no sections prints without error', () => {
  const text = formatCoverage(coverage({ suite: 'Empty', sections: [], cases: [] }));
  assert.match(text, /^Cases: 0\n\nBy section\n\nBy priority/);
});

test('the coverage text lists the total and each block', () => {
  const text = formatCoverage(coverage(makeSuite()));
  assert.match(text, /^Cases: 4\n/);
  assert.match(text, /By priority\n {2}Critical {4}0\n {2}High {8}2/);
});
