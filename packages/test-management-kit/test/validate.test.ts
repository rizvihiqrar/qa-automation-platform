import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, validateSuite } from '../src/validate.ts';
import { makeCase, makeSuite } from './helpers.ts';

test('a clean suite has no problems', () => {
  assert.deepEqual(validateSuite(makeSuite()), []);
});

test('every required field is reported when it is missing or blank', () => {
  for (const name of ['title', 'description', 'expectedResult', 'priority', 'type'] as const) {
    for (const blank of ['', '   ']) {
      const suite = makeSuite();
      suite.cases[0] = makeCase({ [name]: blank });
      const issues = validateSuite(suite);
      assert.ok(issues.some((i) => i.field === name && i.message === 'Missing ' + name), name + ' = "' + blank + '"');
    }
  }
});

test('a missing ID is reported', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ id: '' });
  assert.ok(validateSuite(suite).some((i) => i.field === 'id' && i.message === 'Missing id'));
});

test('a repeated ID is reported once, for the second case', () => {
  const suite = makeSuite();
  suite.cases[1] = makeCase({ id: 'AAA-001' });
  const repeats = validateSuite(suite).filter((i) => i.message.includes('is repeated'));
  assert.equal(repeats.length, 1);
  assert.equal(repeats[0]?.id, 'AAA-001');
});

test('an unknown priority names the allowed values', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ priority: 'Urgent' });
  const issue = validateSuite(suite).find((i) => i.field === 'priority');
  assert.match(issue?.message ?? '', /Unknown priority "Urgent" \(use Critical, High, Medium, Low\)/);
});

test('an unknown type names the allowed values', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ type: 'Smoke' });
  const issue = validateSuite(suite).find((i) => i.field === 'type');
  assert.match(issue?.message ?? '', /Unknown type "Smoke" \(use Regression, Integration, Negative, Security\)/);
});

test('a case in an unknown section is reported', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ id: 'ZZZ-001', section: 'ZZZ' });
  assert.ok(validateSuite(suite).some((i) => i.field === 'section' && i.message === 'Unknown section "ZZZ"'));
});

test('an ID whose prefix is not its section is reported', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ id: 'BBB-009', section: 'AAA' });
  assert.ok(validateSuite(suite).some((i) => i.message.includes('does not match section')));
});

test('an ID that is not PREFIX-000 is reported', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ id: 'AAA-1' });
  assert.ok(validateSuite(suite).some((i) => i.message.includes('should look like')));
});

test('a repeated section ID is reported', () => {
  const suite = makeSuite();
  suite.sections.push({ id: 'AAA', name: 'Again' });
  assert.ok(validateSuite(suite).some((i) => i.message === 'Section ID "AAA" is repeated'));
});

test('references must be a list', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ references: 'JIRA-1' as unknown as string[] });
  assert.ok(validateSuite(suite).some((i) => i.field === 'references'));
});

test('a file with the wrong shape is reported, not thrown on', () => {
  const noLists = validateSuite({ suite: 'S' } as never);
  assert.deepEqual(noLists.map((i) => i.field), ['sections', 'cases']);
  const suite = makeSuite();
  suite.sections.push({ id: 'CCC' } as never, {} as never);
  const messages = validateSuite(suite).map((i) => i.message);
  assert.ok(messages.includes('Section has no name'));
  assert.ok(messages.includes('Section has no ID'));
});

test('a section ID must be capital letters and digits', () => {
  const suite = makeSuite();
  suite.sections.push({ id: 'ccc', name: 'Third' });
  assert.ok(validateSuite(suite).some((i) => i.message.includes('should be capital letters and digits')));
});

test('two sections cannot share a name', () => {
  const suite = makeSuite();
  suite.sections.push({ id: 'CCC', name: 'First section' });
  assert.ok(validateSuite(suite).some((i) => i.message === 'Section name "First section" is repeated'));
});

test('references must be non-empty text', () => {
  for (const bad of [[1], [null], [''], 'QA-1']) {
    const suite = makeSuite();
    suite.cases[0] = makeCase({ references: bad as never });
    assert.ok(validateSuite(suite).some((i) => i.field === 'references'), JSON.stringify(bad));
  }
  const suite = makeSuite();
  suite.cases[0] = makeCase({ references: ['QA-1', 'QA-2'] });
  assert.deepEqual(validateSuite(suite), []);
});

test('text a spreadsheet would read as a formula is reported', () => {
  for (const start of ['=', '+', '-', '@']) {
    const suite = makeSuite();
    suite.cases[0] = makeCase({ expectedResult: start + 'SUM(A1:A2)' });
    const issue = validateSuite(suite).find((i) => i.message.includes('reads as a formula'));
    assert.equal(issue?.field, 'expectedResult', start);
  }
  const suite = makeSuite();
  suite.cases[0] = makeCase({ title: 'Ends with a dash -' });
  assert.deepEqual(validateSuite(suite), []);
});

test('a plan with the wrong shape is reported, not thrown on', () => {
  const suite = makeSuite();
  assert.equal(validatePlan({ name: 'P' } as never, suite)[0]?.message, 'runs must be a list');
  const issues = validatePlan({ name: 'P', runs: [{ name: 'NoFilter' }, { where: { priority: ['High'] } }, { name: 'Text', where: { priority: 'High' } }] } as never, suite);
  const messages = issues.map((i) => i.message);
  assert.ok(messages.includes('Run "NoFilter" needs a where filter'));
  assert.ok(messages.includes('Run has no name'));
  assert.ok(messages.includes('Filter "priority" must be a list with at least one value'));
});

test('an empty filter list is reported as a bad filter', () => {
  const issues = validatePlan({ name: 'P', runs: [{ name: 'R', where: { type: [] } }] }, makeSuite());
  assert.deepEqual(issues.map((i) => i.message), ['Filter "type" must be a list with at least one value']);
});

test('a misspelt filter key is reported once, not again as selecting no cases', () => {
  const issues = validatePlan({ name: 'P', runs: [{ name: 'R', where: { priorty: ['High'] } as never }] }, makeSuite());
  assert.deepEqual(issues.map((i) => i.message), ['Unknown filter "priorty"']);
});

test('a plan with known filters that select cases is clean', () => {
  const plan = { name: 'P', runs: [{ name: 'Smoke', where: { priority: ['High'] } }] };
  assert.deepEqual(validatePlan(plan, makeSuite()), []);
});

test('a plan filter with an unknown value or key is reported', () => {
  const suite = makeSuite();
  const badValue = validatePlan({ name: 'P', runs: [{ name: 'R', where: { priority: ['Urgent'] } }] }, suite);
  assert.ok(badValue.some((i) => i.message === 'Unknown priority "Urgent"'));
  const badKey = validatePlan({ name: 'P', runs: [{ name: 'R', where: { owner: ['me'] } as never }] }, suite);
  assert.ok(badKey.some((i) => i.message === 'Unknown filter "owner"'));
});

test('a run that selects no cases is reported', () => {
  const suite = makeSuite();
  const issues = validatePlan({ name: 'P', runs: [{ name: 'Empty', where: { priority: ['Low'] } }] }, suite);
  assert.ok(issues.some((i) => i.message === 'Run "Empty" selects no cases'));
});

test('a repeated run name is reported', () => {
  const run = { name: 'Smoke', where: { priority: ['High'] } };
  assert.ok(validatePlan({ name: 'P', runs: [run, run] }, makeSuite()).some((i) => i.message.includes('is repeated')));
});
