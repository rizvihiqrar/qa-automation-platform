// Keeps docs/ai-written-code honest: every line of the discount code request is in
// the review log word for word, every finding is complete and points to a rule the
// reviewed spec really has, and the spec inside the prompt is the reviewed spec to
// the character. A reworded spec, a renumbered rule or a prompt that drifted from
// the spec fails here instead of leaving a case study that no longer matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'ai-written-code');
// CRLF working copies on Windows read the same as LF ones on CI.
const read = (...p) => fs.readFileSync(path.join(DIR, ...p), 'utf8').replaceAll('\r\n', '\n');

const KINDS = ['missing', 'ambiguous', 'risk'];
const FIELDS = ['Where', 'Kind', 'Question', 'Decision', 'Rule'];

const request = read('request.md');
const log = read('review-log.md');
const spec = read('spec.md');
const prompt = read('ai-run', 'prompt.md');
const readme = read('README.md');

// The request's bullet list plus its first sentence after the title.
function requestLines(md) {
  const body = md.split('\n---\n')[1];
  const lines = body.split('\n').filter((l) => l.trim());
  const intro = lines.find((l) => !l.startsWith('**') && !l.startsWith('- ') && l.includes('Admins create'));
  const sentence = intro.slice(intro.indexOf('Admins create'));
  return [sentence, ...lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2))];
}

// "| L1 | text | verdict | DC-01, DC-02 |" rows of the line table.
function lineRows(md) {
  return [...md.matchAll(/^\| (L\d+) \| (.+?) \| (clear|needs work) \| ([^|]*?) ?\|$/gm)].map(
    ([, id, text, verdict, ids]) => ({ id, text, verdict, findings: ids.split(',').map((s) => s.trim()).filter(Boolean) }),
  );
}

// "### DC-01 Title" (review log) or "### CR-01 Title" (code review) sections, with
// their "- **Field:** value" lines; a section ends at the next "##" heading.
function findings(md, prefix = 'DC') {
  const re = new RegExp(`^### (${prefix}-\\d+) (.+)\\n([\\s\\S]*?)(?=^##|(?![\\s\\S]))`, 'gm');
  return [...md.matchAll(re)].map(([, id, title, body]) => {
    const fields = Object.fromEntries([...body.matchAll(/^- \*\*(.+?):\*\* (.+)$/gm)].map(([, k, v]) => [k, v]));
    return { id, title, fields };
  });
}

// The spec text the AI was given: between the first two "---" lines of spec.md.
const specBody = (md) => md.split('\n---\n')[1];
const ruleIds = (md) => [...md.matchAll(/^- \*\*(DC-R\d+)\*\*/gm)].map(([, id]) => id);
const outOfScope = (md) => {
  const section = md.split('### Out of scope\n')[1].split('\n---')[0];
  return section.split('\n').filter((l) => l.startsWith('- '));
};

const rows = lineRows(log);
const all = findings(log);
const rules = ruleIds(specBody(spec));

test('every line of the request is in the review log, word for word and in order', () => {
  const lines = requestLines(request);
  assert.equal(lines.length, 9);
  assert.deepEqual(rows.map((r) => r.text), lines);
  assert.deepEqual(rows.map((r) => r.id), lines.map((_, i) => `L${i + 1}`));
});

test('a line needs work exactly when it has findings', () => {
  for (const r of rows) assert.equal(r.verdict === 'needs work', r.findings.length > 0, r.id);
});

test('findings are numbered in order with no gaps or repeats', () => {
  assert.deepEqual(all.map((f) => f.id), all.map((_, i) => `DC-${String(i + 1).padStart(2, '0')}`));
});

test('every finding has every field and a known kind', () => {
  for (const f of all) {
    assert.deepEqual(Object.keys(f.fields), FIELDS, f.id);
    assert.ok(KINDS.includes(f.fields.Kind), `${f.id}: kind "${f.fields.Kind}"`);
  }
});

test('every finding sits under exactly one line, and that is the line it names', () => {
  const listed = rows.flatMap((r) => r.findings.map((id) => ({ id, line: r.id })));
  assert.deepEqual(listed.map((l) => l.id).sort(), all.map((f) => f.id).sort());
  for (const { id, line } of listed) {
    assert.equal(all.find((f) => f.id === id).fields.Where, line, id);
  }
});

test('spec rules are numbered in order with no gaps or repeats', () => {
  assert.ok(rules.length > 0);
  assert.deepEqual(rules, rules.map((_, i) => `DC-R${String(i + 1).padStart(2, '0')}`));
});

test('every rule a finding names exists in the spec', () => {
  for (const f of all) {
    if (f.fields.Rule === 'none') continue;
    const named = f.fields.Rule.split(',').map((s) => s.trim());
    for (const r of named) assert.ok(rules.includes(r), `${f.id} names ${r}`);
  }
});

test('the open questions are exactly the spec\'s out-of-scope items', () => {
  const open = all.filter((f) => f.fields.Rule === 'none');
  assert.equal(open.length, outOfScope(specBody(spec)).length);
});

test('the prompt contains the reviewed spec to the character', () => {
  const block = prompt.match(/<!-- spec:start -->\n([\s\S]*?)<!-- spec:end -->/);
  assert.ok(block, 'prompt has spec markers');
  assert.equal(block[1].trim(), specBody(spec).trim());
});

test('the README totals match the log and the spec', () => {
  const total = (label) => Number(readme.match(new RegExp(`^\\| ${label} \\| (\\d+) \\|$`, 'm'))?.[1]);
  assert.equal(total('Request lines'), rows.length);
  assert.equal(total('Needed work'), rows.filter((r) => r.verdict === 'needs work').length);
  assert.equal(total('Findings'), all.length);
  assert.equal(total('Rules in the reviewed spec'), rules.length);
  for (const kind of KINDS) {
    const row = readme.match(new RegExp(`^\\| ${kind} \\| (\\d+) \\|`, 'm'));
    assert.ok(row, `README row for ${kind}`);
    assert.equal(Number(row[1]), all.filter((f) => f.fields.Kind === kind).length, kind);
  }
});

// Day 38: the code review (code-review.md) and the designed cases it counts, in
// packages/qa-practice-api/tests/discounts. Each case names its ID and its rule
// once, as a table row ['DC-BVA-01', 'DC-R01', …] or a title 'DC-ST-01 [DC-R21] …'.
const review = read('code-review.md');
const CASES = path.join(ROOT, 'packages', 'qa-practice-api', 'tests', 'discounts');
const SCENARIO = path.join(ROOT, 'packages', 'api-drift-checker', 'scenarios', 'qa-practice-api.js');
const REVIEW_KINDS = ['defect', 'spec gap', 'risk'];
const REVIEW_FIELDS = ['Rule', 'Kind', 'Where', 'Found by', 'What happened', 'Tests', 'Fix'];
const TECHNIQUES = ['BVA', 'DT', 'EP', 'AC', 'ST', 'EX'];

const cases = fs.readdirSync(CASES).filter((f) => f.endsWith('.spec.ts')).sort().flatMap((file) => {
  const src = fs.readFileSync(path.join(CASES, file), 'utf8');
  return [
    ...src.matchAll(/\['(DC-[A-Z]+-\d{2})', '(DC-R\d{2})'/g),
    ...src.matchAll(/['`](DC-[A-Z]+-\d{2}) \[(DC-R\d{2})\]/g),
  ].map(([, id, rule]) => ({ id, rule, file }));
});
const crs = findings(review, 'CR');
const listOf = (value) => (value === 'none' ? [] : value.split(',').map((s) => s.trim()));
const brokenBy = (rule) => crs.filter((f) => f.fields.Kind === 'defect' && listOf(f.fields.Rule).includes(rule)).map((f) => f.id);
// Cases that failed on the AI's code: those listed under a defect or the spec gap.
const failedOnAiCode = [...new Set(crs.filter((f) => f.fields.Kind !== 'risk').flatMap((f) => listOf(f.fields.Tests)))];

test('designed discount cases: unique IDs, numbered without gaps for each technique', () => {
  assert.ok(cases.length > 0);
  for (const t of TECHNIQUES) {
    const ids = cases.filter((c) => c.id.startsWith(`DC-${t}-`)).map((c) => c.id).sort();
    assert.ok(ids.length > 0, t);
    assert.deepEqual(ids, ids.map((_, i) => `DC-${t}-${String(i + 1).padStart(2, '0')}`), t);
  }
  assert.equal(cases.filter((c) => !TECHNIQUES.some((t) => c.id.startsWith(`DC-${t}-`))).length, 0);
});

test('every case names a spec rule, and every rule but DC-R25 has a case', () => {
  for (const c of cases) assert.ok(rules.includes(c.rule), `${c.id} names ${c.rule}`);
  const covered = new Set(cases.map((c) => c.rule));
  for (const r of rules.filter((r) => r !== 'DC-R25')) assert.ok(covered.has(r), `${r} has no case`);
});

test('DC-R25: the drift scenario calls every /discounts operation and sends a discount_code', () => {
  const src = fs.readFileSync(SCENARIO, 'utf8');
  for (const [method, p] of [['GET', '/discounts'], ['POST', '/discounts'], ['GET', '/discounts/{code}'], ['PATCH', '/discounts/{code}']]) {
    assert.ok(src.includes(`method: '${method}', path: '${p}'`), `${method} ${p}`);
  }
  assert.match(src, /discount_code: v\.code/);
});

test('code review findings are numbered in order, complete, of a known kind, and name real rules', () => {
  assert.ok(crs.length > 0);
  assert.deepEqual(crs.map((f) => f.id), crs.map((_, i) => `CR-${String(i + 1).padStart(2, '0')}`));
  for (const f of crs) {
    assert.deepEqual(Object.keys(f.fields), REVIEW_FIELDS, f.id);
    assert.ok(REVIEW_KINDS.includes(f.fields.Kind), `${f.id}: kind "${f.fields.Kind}"`);
    for (const r of listOf(f.fields.Rule)) assert.ok(rules.includes(r), `${f.id} names ${r}`);
    assert.match(f.fields.Where, /`d775d20`/, `${f.id} points at the AI's commit`);
  }
});

test('a finding\'s tests exist and check one of its rules; every defect and spec gap has one', () => {
  for (const f of crs) {
    const tests = listOf(f.fields.Tests);
    if (f.fields.Kind !== 'risk') assert.ok(tests.length > 0, `${f.id} has no test`);
    for (const id of tests) {
      const c = cases.find((x) => x.id === id);
      assert.ok(c, `${f.id} lists ${id}, which no case file has`);
      assert.ok(listOf(f.fields.Rule).includes(c.rule), `${f.id} lists ${id}, which checks ${c.rule}`);
    }
  }
});

test('the rule coverage table matches the case files and the defects', () => {
  const table = [...review.matchAll(/^\| (DC-R\d{2}) \| ([^|]+) \| ([^|]+) \|$/gm)].map(([, rule, n, verdict]) => ({ rule, n, verdict }));
  assert.deepEqual(table.map((r) => r.rule), rules);
  for (const { rule, n, verdict } of table) {
    if (rule === 'DC-R25') assert.equal(n, 'drift check');
    else assert.equal(Number(n), cases.filter((c) => c.rule === rule).length, rule);
    const by = brokenBy(rule);
    assert.equal(verdict, by.length ? `broken (${by.join(', ')})` : 'met', rule);
  }
});

test('the technique table and the result totals match the cases and findings', () => {
  for (const t of TECHNIQUES) {
    const row = review.match(new RegExp(`^\\| .+ \\| DC-${t} \\| (\\d+) \\|$`, 'm'));
    assert.ok(row, `technique row for DC-${t}`);
    assert.equal(Number(row[1]), cases.filter((c) => c.id.startsWith(`DC-${t}-`)).length, t);
  }
  const total = (label) => Number(review.match(new RegExp(`^\\| ${label} \\| (\\d+) \\|$`, 'm'))?.[1]);
  assert.equal(total('Rules reviewed'), rules.length);
  assert.equal(total('Rules the AI\'s code broke'), rules.filter((r) => brokenBy(r).length).length);
  assert.equal(total('Designed test cases'), cases.length);
  assert.equal(total('Cases that failed on the AI\'s code'), failedOnAiCode.length);
  assert.equal(total('Findings'), crs.length);
  for (const kind of REVIEW_KINDS) {
    const row = review.match(new RegExp(`^\\| ${kind} \\| (\\d+) \\|`, 'm'));
    assert.ok(row, `result row for ${kind}`);
    assert.equal(Number(row[1]), crs.filter((f) => f.fields.Kind === kind).length, kind);
  }
  assert.ok(review.includes(`${cases.length} cases were run on \`d775d20\` before any fix: ${failedOnAiCode.length} failed`));
});
