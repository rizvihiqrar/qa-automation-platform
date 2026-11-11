import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formField, FORM, LAYERS, loadSeed, parseIssue, regressionTestsOf, summarize, type Entry, type IssueLike } from '../src/escaped.ts';
import { readSeed, repoRoot } from '../src/build.ts';
import { LABEL } from '../src/live.ts';

const form = (layer: string, should: string, added: string) =>
  `### Which layer missed it\n\n${layer}\n\n### Which test should have caught it\n\n${should}\n\n### Test added\n\n${added}\n`;
const issue = (number: number, body: string): IssueLike => ({ number, title: `Bug ${number}`, body, created_at: '2026-11-05T12:00:00Z', html_url: `https://github.com/o/r/issues/${number}` });

test('formField reads the answer under one heading and treats a blank answer as missing', () => {
  const body = form('unit', 'a test', '_No response_');
  assert.equal(formField(body, 'Which layer missed it'), 'unit');
  assert.equal(formField(body, 'Test added'), null);
  assert.equal(formField(body, 'No such heading'), null);
});

test('an issue filled in with the form becomes an escaped entry dated by when it was opened', () => {
  const parsed = parseIssue(issue(7, form('integration', 'A retry test', 'receiver.test: retries on 409')));
  assert.ok('entry' in parsed);
  assert.deepEqual(parsed.entry, {
    id: 'issue-7', title: 'Bug 7', found: '2026-11-05', escaped: true, layer: 'integration',
    shouldHaveCaught: 'A retry test', testsAdded: ['receiver.test: retries on 409'], source: 'https://github.com/o/r/issues/7',
  });
});

test('an issue with no layer, an unknown layer or no should-have-caught answer is a problem, not a quiet zero', () => {
  for (const body of [form('_No response_', 'x', 'y'), form('made-up-layer', 'x', 'y'), form('unit', '_No response_', 'y'), '']) {
    const parsed = parseIssue(issue(8, body));
    assert.ok('problem' in parsed, `body: ${JSON.stringify(body.slice(0, 40))}`);
  }
});

test('the date found is the one on the form, or the day the issue was opened when it is blank', () => {
  const dated = parseIssue(issue(10, `${form('unit', 'x', 'y')}\n### Date found\n\n2026-10-30\n`));
  assert.ok('entry' in dated);
  assert.equal(dated.entry.found, '2026-10-30');
  const blank = parseIssue(issue(11, `${form('unit', 'x', 'y')}\n### Date found\n\n_No response_\n`));
  assert.ok('entry' in blank);
  assert.equal(blank.entry.found, '2026-11-05');
});

test('a date found that is not a date is a problem, not a silent wrong month', () => {
  const parsed = parseIssue(issue(12, `${form('unit', 'x', 'y')}\n### Date found\n\nlast Tuesday\n`));
  assert.ok('problem' in parsed);
});

test('an issue with no test added yet is kept, so the report can list it as still without a test', () => {
  const parsed = parseIssue(issue(9, form('unit', 'a unit test', '_No response_')));
  assert.ok('entry' in parsed);
  assert.deepEqual(parsed.entry.testsAdded, []);
});

test('summarize counts escaped bugs by layer in one month and lists the ones with no test', () => {
  const entry = (id: string, found: string, escaped: boolean, layer: Entry['layer'], tests: string[]): Entry =>
    ({ id, title: id, found, escaped, layer, shouldHaveCaught: 'x', testsAdded: tests, source: 's' });
  const result = summarize([
    entry('a', '2026-11-01', true, 'unit', ['t']),
    entry('b', '2026-11-02', true, 'unit', []),
    entry('c', '2026-11-03', true, 'review', ['t']),
    entry('d', '2026-11-04', false, null, ['t']),
    entry('e', '2026-10-30', true, 'load', ['t']),
  ], '2026-11');
  assert.deepEqual(result.escaped.map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(result.caughtBeforeMain, 1);
  assert.deepEqual(result.byLayer, [{ layer: 'unit', count: 2 }, { layer: 'review', count: 1 }]);
  assert.deepEqual(result.withoutTest.map((e) => e.id), ['b']);
});

test('regressionTestsOf reads the tests a write-up lists, and nothing from other sections', () => {
  const page = '# T\n\n## Fix\n\n- [`x/y.js`](../x) › `not this one`\n\n## Regression tests\n\n- [`packages/a/test/b.test.js`](../../packages/a/test/b.test.js) › `first test`\n- [`packages/a/test/c.test.js`](../../packages/a/test/c.test.js) › `second test`\n\nPut back once.\n\n## Prevention\n';
  assert.deepEqual(regressionTestsOf(page), [{ file: 'packages/a/test/b.test.js', name: 'first test' }, { file: 'packages/a/test/c.test.js', name: 'second test' }]);
  assert.deepEqual(regressionTestsOf('# no such section'), []);
});

// The seed file is the record of which write-ups escaped. These checks keep it honest.
const rcaDir = path.join(repoRoot, 'docs', 'rca');
const pages = fs.readdirSync(rcaDir).filter((f) => /^\d{2}-.+\.md$/.test(f));

test('every root-cause write-up has an entry in the escaped-bug seed (the break: add a write-up, forget its entry)', () => {
  const covered = new Set(readSeed().map((s) => s.rca));
  for (const page of pages) assert.ok(covered.has(page), `${page} has an entry in data/escaped-bugs.json`);
});

test('every seed entry points at a real write-up, has a unique id and a valid date and layer', () => {
  const seed = readSeed();
  assert.equal(new Set(seed.map((s) => s.id)).size, seed.length, 'ids are unique');
  for (const s of seed) {
    assert.ok(pages.includes(s.rca), `${s.id}: ${s.rca} exists in docs/rca`);
    assert.match(s.found, /^\d{4}-\d{2}-\d{2}$/, `${s.id}: found is a date`);
    assert.ok(s.shouldHaveCaught.length > 20, `${s.id}: says which test should have caught it`);
    if (s.escaped) assert.ok(s.layer && (LAYERS as readonly string[]).includes(s.layer), `${s.id}: an escaped bug names its layer`);
    else assert.equal(s.layer, null, `${s.id}: a bug caught before main has no missing layer`);
  }
});

test('every seed entry has at least one regression test, read from its write-up', () => {
  for (const entry of loadSeed(repoRoot, readSeed())) assert.ok(entry.testsAdded.length > 0, `${entry.id} has a regression test in its write-up`);
});

test('a write-up that holds two bugs gives each entry only its own tests', () => {
  const byId = Object.fromEntries(loadSeed(repoRoot, readSeed()).map((e) => [e.id, e.testsAdded]));
  assert.equal(byId['rca-02a']!.length, 1);
  assert.equal(byId['rca-02b']!.length, 2);
});

// The issue form is what people fill in; the parser reads what it produces. If one changes
// without the other, every new issue would be reported as unreadable.
const formYaml = fs.readFileSync(path.join(repoRoot, '.github', 'ISSUE_TEMPLATE', 'escaped-bug.yml'), 'utf8');

test('the issue form asks the three questions the report reads, under the same headings (the break: rename a label)', () => {
  const labels = [...formYaml.matchAll(/^\s+label: (.+)$/gm)].map((m) => m[1]);
  for (const heading of [FORM.layer, FORM.shouldHave, FORM.added, FORM.found]) assert.ok(labels.includes(heading), `the form has a field labelled "${heading}"`);
});

test('the issue form offers exactly the layers the report knows, and adds the escaped-bug label', () => {
  const options = [...(formYaml.split('options:')[1] ?? '').split('validations:')[0]!.matchAll(/^\s+- (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(options, [...LAYERS]);
  assert.match(formYaml, /labels: \["escaped-bug"\]/);
  assert.equal(LABEL, 'escaped-bug');
});

test('an issue as GitHub writes it from the form is read by the parser', () => {
  const body = '### What happened\n\nIt broke.\n\n### Which layer missed it\n\nci-environment\n\n### Which test should have caught it\n\nA Windows run\n\n### Test added\n\n_No response_';
  const parsed = parseIssue(issue(12, body));
  assert.ok('entry' in parsed);
  assert.equal(parsed.entry.layer, 'ci-environment');
});
