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

function findings(md) {
  return [...md.matchAll(/^### (DC-\d+) (.+)\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)].map(([, id, title, body]) => {
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
