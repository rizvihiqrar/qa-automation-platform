// Keeps docs/requirement-review honest: every acceptance criterion of the ten
// feature files is in the log word for word, every finding is complete, and every
// finding is tied to a test that exists (a known-defect test for a defect, no test
// only for an open question). A reworded feature file, a deleted test or a
// finding with nothing behind it fails here instead of leaving a log that no
// longer matches the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'packages', 'ai-test-generator');
const FEATURES = path.join(PKG, 'examples', 'input');
const REVIEW_TESTS = path.join(PKG, 'tests', 'review');
const REGRESSION_TESTS = path.join(PKG, 'tests', 'regression');
// CRLF working copies on Windows read the same as LF ones on CI.
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8').replaceAll('\r\n', '\n');

const KINDS = ['ambiguous', 'missing criterion', 'weak criterion', 'hidden precondition', 'inconsistent'];
const RESULTS = ['defect', 'test gap', 'rule clarified', 'open question'];
const FIELDS = ['Where', 'Kind', 'Result', 'Question', 'Live site', 'Generated test', 'Decision', 'Test'];

const log = read(ROOT, 'docs', 'requirement-review', 'review-log.md');
const readme = read(ROOT, 'docs', 'requirement-review', 'README.md');

// Criteria of a feature file: the "- " lines under "Acceptance Criteria:".
export function criteria(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf('Acceptance Criteria:');
  return start === -1 ? [] : lines.slice(start + 1).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
}

// The log split into "## feature" sections.
export function sections(md) {
  return [...md.matchAll(/^## (\S+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map(([, name, body]) => ({ name, body }));
}

// "| C1 | text | verdict | RV-01, RV-02 |" rows of a section.
export function criterionRows(body) {
  return [...body.matchAll(/^\| (C\d+) \| (.+?) \| (clear|needs work) \| ([^|]*)\|$/gm)].map(([, id, text, verdict, ids]) => ({
    id, text: text.replace(/\\\|/g, '|'), verdict, findings: ids.match(/RV-\d+/g) ?? [],
  }));
}

// "### RV-01 title" blocks with their "- **Field:** value" lines.
export function findings(md) {
  return [...md.matchAll(/^### (RV-\d+) (.+)\n([\s\S]*?)(?=^### |^## |(?![\s\S]))/gm)].map(([, id, title, body]) => {
    const fields = Object.fromEntries([...body.matchAll(/^- \*\*([^:*]+):\*\* (.+)$/gm)].map((m) => [m[1], m[2]]));
    return { id, title, fields };
  });
}

// Titles of the review tests: { id, callee } for test('RV-nn ...') and defect('RV-nn ...').
export function reviewTests() {
  return fs.readdirSync(REVIEW_TESTS).filter((f) => f.endsWith('.spec.js')).flatMap((f) =>
    [...read(REVIEW_TESTS, f).matchAll(/\b(test|defect)\(\s*[`'"](RV-\d+):/g)].map((m) => ({ file: f, callee: m[1], id: m[2] })));
}

const features = fs.readdirSync(FEATURES).filter((f) => f.endsWith('.txt')).sort();
const logSections = sections(log);
const allFindings = findings(log);
const tests = reviewTests();

test('there is one log section per feature file, in file order', () => {
  assert.equal(features.length, 10);
  assert.deepEqual(logSections.map((s) => s.name), features.map((f) => f.replace(/^feature-|\.txt$/g, '')));
});

for (const file of features) {
  const name = file.replace(/^feature-|\.txt$/g, '');

  test(`${name}: the log lists every criterion word for word, with a verdict that matches its findings`, () => {
    const expected = criteria(read(FEATURES, file));
    assert.ok(expected.length > 0, 'no criteria found in the feature file');
    const rows = criterionRows(logSections.find((s) => s.name === name)?.body ?? '');
    assert.deepEqual(rows.map((r) => r.id), expected.map((_, i) => `C${i + 1}`));
    assert.deepEqual(rows.map((r) => r.text), expected);
    for (const r of rows) {
      if (r.verdict === 'clear') assert.deepEqual(r.findings, [], `${name} ${r.id} is clear but lists findings`);
      else assert.ok(r.findings.length > 0, `${name} ${r.id} needs work but lists no finding`);
    }
  });
}

test('finding IDs are RV-01 upward without gaps or repeats', () => {
  assert.deepEqual(allFindings.map((f) => f.id), allFindings.map((_, i) => `RV-${String(i + 1).padStart(2, '0')}`));
  assert.ok(allFindings.length >= 20);
});

test('every finding has every field, with a known kind and result', () => {
  for (const f of allFindings) {
    for (const field of FIELDS) assert.ok(f.fields[field]?.trim(), `${f.id}: missing "${field}"`);
    assert.ok(KINDS.includes(f.fields.Kind), `${f.id}: unknown kind "${f.fields.Kind}"`);
    assert.ok(RESULTS.includes(f.fields.Result), `${f.id}: unknown result "${f.fields.Result}"`);
  }
});

test('criteria and findings point at each other', () => {
  const ids = new Set(allFindings.map((f) => f.id));
  const inTables = new Set(logSections.flatMap((s) => criterionRows(s.body).flatMap((r) => r.findings)));
  for (const id of inTables) assert.ok(ids.has(id), `a criterion row cites ${id}, which has no finding`);
  for (const f of allFindings) {
    const names = /^C\d/.test(f.fields.Where);
    assert.equal(inTables.has(f.id), names, names
      ? `${f.id} says it is about ${f.fields.Where} but no criterion row lists it`
      : `${f.id} is listed on a criterion row but its Where is "${f.fields.Where}"`);
  }
});

test('every finding has the test its result calls for', () => {
  for (const f of allFindings) {
    const spec = f.fields.Test;
    const review = spec.match(/^review (RV-\d+)$/);
    const regression = spec.match(/^regression `([^`]+)` › `([^`]+)`$/);
    if (f.fields.Result === 'open question') {
      assert.equal(spec, 'none', `${f.id}: an open question has no test`);
    } else if (review) {
      assert.equal(review[1], f.id, `${f.id}: names another finding's test`);
      const mine = tests.filter((t) => t.id === f.id);
      assert.ok(mine.length > 0, `${f.id}: no review test with that ID`);
      const expectedFail = mine.map((t) => t.callee === 'defect');
      if (f.fields.Result === 'defect') assert.ok(expectedFail.every(Boolean), `${f.id}: a defect needs known-defect tests only`);
      else assert.ok(expectedFail.every((x) => !x), `${f.id}: only a defect may use the known-defect wrapper`);
    } else if (regression) {
      assert.notEqual(f.fields.Result, 'defect', `${f.id}: a defect needs a known-defect test`);
      assert.ok(read(REGRESSION_TESTS, regression[1]).includes(regression[2]), `${f.id}: no test "${regression[2]}" in ${regression[1]}`);
    } else {
      assert.fail(`${f.id}: Test must be "review RV-nn", "regression \`file\` › \`title\`" or "none" (open question), got "${spec}"`);
    }
  }
});

test('every review test cites a finding in the log', () => {
  const ids = new Set(allFindings.map((f) => f.id));
  assert.ok(tests.length > 0);
  for (const t of tests) assert.ok(ids.has(t.id), `${t.file}: test ${t.id} has no finding`);
});

test('the totals in the README match the log', () => {
  const rows = allFindings.length;
  const rowCount = (label) => Number(readme.match(new RegExp(`^\\| ${label} \\| (\\d+) \\|`, 'm'))?.[1]);
  const all = logSections.flatMap((s) => criterionRows(s.body));
  assert.equal(rowCount('Criteria reviewed'), all.length);
  assert.equal(rowCount('Clear as written'), all.filter((r) => r.verdict === 'clear').length);
  assert.equal(rowCount('Needed work'), all.filter((r) => r.verdict === 'needs work').length);
  assert.equal(rowCount('Findings'), rows);
  for (const result of RESULTS) {
    const shown = Number(readme.match(new RegExp(`^\\| ${result} \\| (\\d+) \\|`, 'm'))?.[1]);
    assert.equal(shown, allFindings.filter((f) => f.fields.Result === result).length, `README count for "${result}"`);
  }
});
