import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseJson, parseFile } from '../src/parse.js';
import { lintReport, RULES } from '../src/rules.js';

const good = {
  source: 't', title: 'Discount code is ignored at checkout', severity: 'High', component: 'Checkout',
  environment: 'Chrome 129, staging', steps: ['Log in', 'Add item', 'Apply SAVE10'],
  expected: 'Total drops by 10%', actual: 'Total is unchanged and no message appears', evidence: ['shot.png'],
};
const rulesFor = (overrides) => lintReport({ ...good, ...overrides }).findings.map((f) => f.rule);

test('a complete report has no findings and scores 100', () => {
  const r = lintReport(good);
  assert.deepEqual(r.findings, []);
  assert.equal(r.score, 100);
  assert.equal(r.status, 'Ready');
});

test('parseMarkdown reads title, fields and sections, stripping list markers', () => {
  const md = [
    '# Login button does nothing on Safari',
    '**Severity:** Medium',
    '**Environment:** Safari 18, iOS',
    'Component: Login',
    '## Steps to Reproduce',
    '1. Open the login page',
    '2) Enter valid details',
    '- Tap Login',
    '## Expected Result',
    'The products page opens.',
    '## Actual Result',
    'Nothing happens; the button stays pressed.',
    '## Attachments',
    '* video.mp4',
  ].join('\r\n');
  const r = parseMarkdown(md, 'a.md');
  assert.equal(r.title, 'Login button does nothing on Safari');
  assert.equal(r.severity, 'Medium');
  assert.equal(r.environment, 'Safari 18, iOS');
  assert.equal(r.component, 'Login');
  assert.deepEqual(r.steps, ['Open the login page', 'Enter valid details', 'Tap Login']);
  assert.equal(r.expected, 'The products page opens.');
  assert.equal(r.actual, 'Nothing happens; the button stays pressed.');
  assert.deepEqual(r.evidence, ['video.mp4']);
});

test('parseMarkdown accepts an Environment section instead of a field', () => {
  const r = parseMarkdown('# t\n## Environment\nChrome on Linux\n## Steps\n1. a\n2. b');
  assert.equal(r.environment, 'Chrome on Linux');
});

test('parseJson accepts Jira-style names and numbers batch entries', () => {
  const reports = parseJson([
    { summary: 'A', priority: 'Low', stepsToReproduce: '1. one\n2. two', expectedResult: 'x', actualResult: 'y' },
    { title: 'B', steps: ['s'], attachments: 'log.txt' },
  ], 'b.json');
  assert.equal(reports[0].source, 'b.json#1');
  assert.equal(reports[0].title, 'A');
  assert.equal(reports[0].severity, 'Low');
  assert.deepEqual(reports[0].steps, ['one', 'two']);
  assert.equal(reports[0].expected, 'x');
  assert.deepEqual(reports[1].evidence, ['log.txt']);
});

test('parseFile picks the parser by extension', () => {
  assert.equal(parseFile('{"title":"x"}', 'one.json')[0].source, 'one.json');
  assert.equal(parseFile('# x', 'one.md')[0].title, 'x');
});

test('missing required parts are errors', () => {
  assert.ok(rulesFor({ title: '' }).includes('title-missing'));
  assert.ok(rulesFor({ severity: '' }).includes('severity-missing'));
  assert.ok(rulesFor({ steps: [] }).includes('steps-missing'));
  assert.ok(rulesFor({ expected: '' }).includes('expected-missing'));
  assert.ok(rulesFor({ actual: '' }).includes('actual-missing'));
  assert.equal(lintReport({ ...good, expected: '' }).status, 'Not ready');
});

test('severity must be one of the four levels, in any case', () => {
  assert.ok(rulesFor({ severity: 'Urgent' }).includes('severity-invalid'));
  assert.ok(!rulesFor({ severity: 'CRITICAL' }).includes('severity-invalid'));
});

test('vague titles are flagged, specific ones are not', () => {
  assert.ok(rulesFor({ title: 'Checkout broken' }).includes('title-vague'));
  assert.ok(rulesFor({ title: 'Bug in the cart page header' }).includes('title-vague'));
  assert.ok(!rulesFor({ title: 'Cart badge shows 0 after adding two items' }).includes('title-vague'));
});

test('expected equal to actual is an error, ignoring case and punctuation', () => {
  assert.ok(rulesFor({ expected: 'Badge shows 1.', actual: 'badge shows 1' }).includes('expected-equals-actual'));
});

test('a short vague actual result is flagged; a detailed one is not', () => {
  assert.ok(rulesFor({ actual: "It doesn't work." }).includes('actual-vague'));
  assert.ok(!rulesFor({ actual: "The page doesn't work after login: a blank white screen appears and the console shows TypeError at app.js line 40" }).includes('actual-vague'));
});

test('one step is a warning; serious defects without evidence are warned', () => {
  assert.ok(rulesFor({ steps: ['Open the app'] }).includes('steps-too-few'));
  assert.ok(rulesFor({ evidence: [] }).includes('evidence-missing'));
  assert.ok(!rulesFor({ evidence: [], severity: 'Low' }).includes('evidence-missing'));
  assert.ok(rulesFor({ environment: '' }).includes('environment-missing'));
});

test('a cosmetic issue marked critical is flagged as a possible mismatch', () => {
  assert.ok(rulesFor({ severity: 'Critical', title: 'Typo in the checkout heading text' }).includes('severity-mismatch'));
  assert.ok(!rulesFor({ severity: 'Low', title: 'Typo in the checkout heading text' }).includes('severity-mismatch'));
});

test('score subtracts 25 per error and 10 per warning, never below 0', () => {
  assert.equal(lintReport({ ...good, environment: '' }).score, 90);
  assert.equal(lintReport({ ...good, environment: '', evidence: [] }).status, 'Needs polish');
  const empty = { source: 'e', title: '', severity: '', environment: '', component: '', steps: [], expected: '', actual: '', evidence: [] };
  assert.equal(lintReport(empty).score, 0);
});

test('every rule has a unique id and a known severity', () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(RULES.every((r) => ['error', 'warning'].includes(r.severity)));
});
