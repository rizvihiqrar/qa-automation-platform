// Checks on the shipped test cases themselves, so a bad edit to data/cases.json fails CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coverage } from '../src/coverage.ts';
import { exportTestRail } from '../src/exporters/testrail.ts';
import { loadPlanDefinition, loadSuite } from '../src/load.ts';
import { buildPlan } from '../src/plan.ts';
import { validatePlan, validateSuite } from '../src/validate.ts';

const suite = loadSuite();
const definition = loadPlanDefinition();

test('the shipped cases and plan pass the validator', () => {
  assert.deepEqual(validateSuite(suite), []);
  assert.deepEqual(validatePlan(definition, suite), []);
});

test('the shipped suite has the counts the README states', () => {
  const counts = coverage(suite);
  assert.equal(counts.total, 52);
  assert.equal(suite.sections.length, 8);
  assert.deepEqual(counts.byPriority, { Critical: 0, High: 31, Medium: 21, Low: 0 });
  assert.deepEqual(counts.byType, { Regression: 33, Integration: 12, Negative: 4, Security: 3 });
});

test('the plan has the smoke, integration and security runs the README states', () => {
  const sizes = Object.fromEntries(buildPlan(suite, definition).runs.map((run) => [run.name, run.caseIds.length]));
  assert.equal(sizes.Smoke, 31);
  assert.equal(sizes.Integration, 12);
  assert.equal(sizes.Security, 7);
});

test('every case sits in exactly one section run', () => {
  const sectionRuns = buildPlan(suite, definition).runs.slice(0, suite.sections.length);
  const ids = sectionRuns.flatMap((run) => run.caseIds).sort();
  assert.deepEqual(ids, suite.cases.map((c) => c.id).sort());
});

test('the TestRail export matches the reviewed import file byte for byte', () => {
  const reviewed = fs.readFileSync(fileURLToPath(new URL('../examples/business-accounting-suite-testrail.csv', import.meta.url)), 'utf8');
  assert.equal(exportTestRail(suite), reviewed);
});

test('case text has no leading or trailing spaces and no tab or line-break characters', () => {
  for (const c of suite.cases) {
    for (const [name, value] of Object.entries(c)) {
      if (typeof value !== 'string') continue;
      assert.equal(value, value.trim(), c.id + '.' + name);
      assert.ok(!/[\t\r\n]/.test(value), c.id + '.' + name);
    }
  }
});
