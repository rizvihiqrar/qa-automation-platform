// The cases, the labels, the recorded runs and the review sheet stay in step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HARD, REAL, VARIANTS } from '../labels/source.ts';
import { applyVariant, build, criteriaOf, lf } from '../src/build-cases.ts';
import { loadRuns, validate } from '../src/record.ts';
import { loadItems, PKG, render, sha256, template } from '../src/render.ts';
import { loadKey, readAnswers } from '../src/review-sheet.ts';

const read = (rel: string) => lf(fs.readFileSync(path.join(PKG, rel), 'utf8'));
const GEN = path.resolve(PKG, '..', 'ai-test-generator');

test('the committed cases are exactly what build-cases produces', () => {
  for (const [rel, content] of build().files) assert.equal(read(rel), content, rel);
});

test('every acceptance criterion of the ten feature files has exactly one real case', () => {
  const files = fs.readdirSync(path.join(GEN, 'examples', 'input'));
  let criteria = 0;
  for (const f of files) {
    const feature = f.replace(/^feature-|\.txt$/g, '');
    const n = criteriaOf(fs.readFileSync(path.join(GEN, 'examples', 'input', f), 'utf8')).length;
    criteria += n;
    const cs = REAL.filter((r) => r.feature === feature).map((r) => r.c);
    assert.deepEqual([...cs].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1), feature);
  }
  assert.equal(criteria, 43);
  assert.equal(REAL.length, 43);
});

test('real cases use the unedited AI-written specs', () => {
  const key = loadKey();
  for (const item of loadItems()) {
    const k = key[item.id];
    if (k?.kind !== 'real') continue;
    const original = lf(fs.readFileSync(path.join(GEN, 'eval', 'runs', 'claude-code-2026-10-16', `feature-${k.feature}.spec.js`), 'utf8'));
    assert.equal(read(`cases/${item.spec}`), original, item.id);
  }
});

test('each variant changes one place in its base spec, and changes it', () => {
  for (const v of [...VARIANTS, ...HARD]) {
    const base = lf(fs.readFileSync(path.join(GEN, 'eval', 'runs', 'claude-code-2026-10-16', `feature-${v.feature}.spec.js`), 'utf8'));
    assert.notEqual(v.find, v.replace, v.key);
    assert.notEqual(applyVariant(base, v.find, v.replace, v.key), base, v.key);
  }
  assert.equal(new Set([...VARIANTS, ...HARD].map((v) => v.key)).size, VARIANTS.length + HARD.length);
});

test('a judge sees nothing that gives the label away', () => {
  const items = read('cases/items.json');
  for (const word of ['label', 'covered', 'partial', 'missing', 'variant', 'borderline', 'reason']) {
    assert.ok(!items.includes(word), `items.json mentions "${word}"`);
  }
  for (const f of fs.readdirSync(path.join(PKG, 'cases', 'specs'))) {
    assert.match(f, /^spec-\d\d\.spec\.js$/);
    const spec = read(`cases/specs/${f}`);
    assert.ok(!/\b[VH]\d\d\b/.test(spec), `${f} names a variant key`);
  }
  assert.ok(!template().includes('{{label}}'), 'the prompt template must not use the label');
});

test('every recorded run answered every case, against the prompts as they are now', () => {
  const items = loadItems();
  const runs = loadRuns();
  assert.deepEqual(
    runs.map((r) => `${r.name} ${r.rubric}`).sort(),
    ['haiku-1', 'haiku-2', 'haiku-3', 'sonnet-1', 'sonnet-2', 'sonnet-3'].flatMap((n) => [`${n} v1`, `${n.replace('-', '-v2-')} v2`]).sort(),
  );
  for (const run of runs) {
    const tpl = template(run.rubric);
    assert.match(run.model, /^claude-(haiku|sonnet)-\d/);
    assert.ok(run.name.startsWith(run.model.split('-')[1] ?? '?'), `${run.name} is named after its model`);
    assert.equal(run.answers.length, items.length, run.name);
    validate(run.answers, items.map((i) => i.id));
    for (const item of items) assert.equal(run.prompts[item.id], sha256(render(item, tpl)), `${run.name} ${item.id}`);
    // v1 answered round 1 and round 2 in two sessions; v2 answered all 67 in one
    assert.deepEqual(run.sessions.map((s) => s.cases), run.rubric === 'v1' ? ['J01–J59', 'J60–J67'] : ['J01–J67'], run.name);
  }
});

test('round 2 came after round 1 without renumbering it', () => {
  const key = loadKey();
  const ids = loadItems().map((i) => i.id);
  const rounds = ids.map((id) => key[id]?.round);
  assert.deepEqual(rounds, [...Array(59).fill(1), ...Array(HARD.length).fill(2)]);
});

test('the review sheet covers every case, and the labels are what the reviewer decided', () => {
  const sheet = read('labels/review-sheet.md');
  const answers = readAnswers(sheet);
  const key = loadKey();
  assert.deepEqual([...answers.keys()].sort(), Object.keys(key).sort());
  const drafts = new Map<string, string>();
  let id = '';
  for (const line of sheet.split('\n')) {
    id = /^### (J\d+)/.exec(line)?.[1] ?? id;
    const draft = /^\*\*Draft:\*\* (\w+)\./.exec(line);
    if (draft && id) drafts.set(id, draft[1] ?? '');
  }
  for (const [id, answer] of answers) {
    const verdict = /^agree\b/.test(answer) ? drafts.get(id) : /^(covered|partial|missing)\b/.exec(answer)?.[1];
    assert.ok(verdict, `${id}: "${answer}" is not agree, covered, partial or missing`);
    assert.equal(key[id]?.label, verdict, `${id}: sheet says ${verdict}, labels say ${key[id]?.label}`);
  }
});
