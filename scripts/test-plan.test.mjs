// Keeps the test strategy and test plan in docs/test-strategy honest against the
// designed tests in packages/qa-practice-api/tests/design: every case in the plan
// is a test and every test is in the plan, each under its technique; every case
// checks a listed requirement and every requirement has cases; the counts quoted
// in both documents add up; and every high risk has tests or a scheduled day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs', 'test-strategy');
const TESTS = path.join(ROOT, 'packages', 'qa-practice-api', 'tests', 'design');
const read = (file) => fs.readFileSync(file, 'utf8');

const strategy = read(path.join(DOCS, 'README.md'));
const plan = read(path.join(DOCS, 'test-plan.md'));

// Each technique: its ID prefix, its "## " heading in the plan, its spec file,
// and its name in the strategy's technique table.
const TECHNIQUES = [
  { prefix: 'EP', heading: 'Equivalence partitioning', file: 'equivalence.spec.ts' },
  { prefix: 'BVA', heading: 'Boundary value analysis', file: 'boundaries.spec.ts' },
  { prefix: 'DT', heading: 'Decision tables', file: 'decision-tables.spec.ts' },
  { prefix: 'ST', heading: 'State transitions', file: 'state-transitions.spec.ts' },
];

// "| TC-EP-01 | REQ-01 | input | expected |" rows, with the "## " section they sit in.
export function planCases(md) {
  const cases = [];
  let heading = null;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) heading = line.slice(3).replace(/:.*/, '');
    const m = line.match(/^\| (TC-[A-Z]+-\d{2}) \| (REQ-\d{2}) \| (.+) \| (.+) \|$/);
    if (m) cases.push({ id: m[1], req: m[2], input: m[3], expected: m[4], heading });
  }
  return cases;
}

// "| REQ-01 | text | R-05, R-11 |" rows.
export function requirements(md) {
  return [...md.matchAll(/^\| (REQ-\d{2}) \| .+ \| (R-\d{2}(?:, R-\d{2})*) \|$/gm)]
    .map(([, id, risks]) => ({ id, risks: risks.split(', ') }));
}

// "| R-01 | risk | L | I | score | tested by | status |" rows.
export function risks(md) {
  return [...md.matchAll(/^\| (R-\d{2}) \| (.+?) \| (\d) \| (\d) \| (\d) \| (.+?) \| (.+?) \|$/gm)]
    .map(([, id, , l, i, score, testedBy, status]) => ({ id, l: +l, i: +i, score: +score, testedBy, status }));
}

// Every TC ID a cell mentions, with "TC-ST-01 to TC-ST-29" expanded.
export function caseRefs(text) {
  const ids = [];
  const pattern = /(TC-([A-Z]+)-(\d{2}))(?: to TC-\2-(\d{2}))?/g;
  for (const [, first, prefix, from, to] of text.matchAll(pattern)) {
    if (!to) { ids.push(first); continue; }
    for (let n = +from; n <= +to; n++) ids.push(`TC-${prefix}-${String(n).padStart(2, '0')}`);
  }
  return ids;
}

// The 'TC-…' IDs in a spec file, as a case table row ('TC-EP-01',) or at the start
// of a test title ('TC-EP-07 stock left out…'). Each case names its ID once.
export function specIds(source) {
  return [...source.matchAll(/'(TC-[A-Z]+-\d{2})[' ]/g)].map((m) => m[1]);
}

const relativeLinks = (md) => [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
  .filter((l) => !/^[a-z]+:/i.test(l) && !l.startsWith('#'))
  .map((l) => l.split('#')[0]);

const cases = planCases(plan);
const caseIds = cases.map((c) => c.id);
const reqs = requirements(plan);
const register = risks(strategy);

test('the plan lists cases, each ID once', () => {
  assert.ok(cases.length >= 80, `only ${cases.length} cases`);
  assert.deepEqual(caseIds.filter((id, i) => caseIds.indexOf(id) !== i), []);
});

for (const { prefix, heading, file } of TECHNIQUES) {
  test(`${heading}: plan cases and ${file} match exactly, in order`, () => {
    const inPlan = cases.filter((c) => c.id.startsWith(`TC-${prefix}-`));
    assert.ok(inPlan.length > 0);
    for (const c of inPlan) assert.equal(c.heading, heading, `${c.id} is under "${c.heading}"`);
    assert.deepEqual(specIds(read(path.join(TESTS, file))), inPlan.map((c) => c.id));
  });
}

test('no spec file in tests/design holds a case outside its technique', () => {
  const specs = fs.readdirSync(TESTS).filter((f) => f.endsWith('.spec.ts')).sort();
  assert.deepEqual(specs, TECHNIQUES.map((t) => t.file).sort());
});

test('every case checks a listed requirement, and every requirement has cases', () => {
  const ids = reqs.map((r) => r.id);
  assert.ok(ids.length >= 10, `only ${ids.length} requirements`);
  for (const c of cases) assert.ok(ids.includes(c.req), `${c.id} cites unknown ${c.req}`);
  for (const id of ids) assert.ok(cases.some((c) => c.req === id), `${id} has no cases`);
});

test('every requirement points at risks in the register', () => {
  const known = register.map((r) => r.id);
  for (const r of reqs) for (const risk of r.risks) assert.ok(known.includes(risk), `${r.id} cites unknown ${risk}`);
});

test('the coverage table matches the cases', () => {
  const table = Object.fromEntries([...plan.matchAll(/^\| (REQ-\d{2}) \| (\d+) \|$/gm)].map(([, id, n]) => [id, +n]));
  const counted = Object.fromEntries(reqs.map((r) => [r.id, cases.filter((c) => c.req === r.id).length]));
  assert.deepEqual(table, counted);
  assert.match(plan, new RegExp(`^\\| \\*\\*Total\\*\\* \\| \\*\\*${cases.length}\\*\\* \\|$`, 'm'));
});

test('the state-transition matrix agrees with the case table', () => {
  const cells = [...plan.matchAll(/ST-(\d{2}) ([✓✗])/g)];
  assert.equal(cells.length, 25);
  for (const [, n, mark] of cells) {
    const c = cases.find((x) => x.id === `TC-ST-${n}`);
    assert.equal(c?.expected, mark === '✓' ? '200' : '409', `TC-ST-${n}`);
  }
});

test('the plan and the state-transition spec expect the same status for every move', () => {
  const rows = [...read(path.join(TESTS, 'state-transitions.spec.ts'))
    .matchAll(/\['(TC-ST-\d{2})', +'(\w+)', +'(\w+)', +(\d{3})\]/g)];
  assert.equal(rows.length, 25);
  for (const [, id, from, to, status] of rows) {
    const c = cases.find((x) => x.id === id);
    assert.equal(c?.input, `${from} → ${to}`, id);
    assert.equal(c?.expected, status, id);
  }
});

test('the risk register scores add up, and every high risk has tests or a scheduled day', () => {
  assert.ok(register.length >= 10, `only ${register.length} risks`);
  for (const r of register) {
    assert.equal(r.score, r.l * r.i, `${r.id} score`);
    if (r.score < 6) continue;
    const scheduled = /\bDay \d+\b/.test(r.testedBy) && /scheduled/i.test(r.status);
    const tested = caseRefs(r.testedBy).length > 0 || /\.spec\.ts\]/.test(r.testedBy);
    assert.ok(scheduled || tested, `${r.id} is high (${r.score}) with no tests and no scheduled day`);
  }
});

test('every case the strategy names exists in the plan', () => {
  const named = caseRefs(strategy);
  assert.ok(named.length > 0);
  for (const id of named) assert.ok(caseIds.includes(id), `strategy names unknown ${id}`);
});

test('the strategy\'s case counts per technique match the plan', () => {
  for (const { prefix, heading } of TECHNIQUES) {
    const row = strategy.match(new RegExp(`^\\| ${heading} \\| .+ \\| (\\d+) \\|$`, 'm'));
    assert.ok(row, `no technique row for ${heading}`);
    assert.equal(+row[1], cases.filter((c) => c.id.startsWith(`TC-${prefix}-`)).length, heading);
  }
  assert.match(strategy, new RegExp(`\\b${cases.length} designed cases\\b`));
});

for (const [name, md] of [['README.md', strategy], ['test-plan.md', plan]]) {
  test(`${name}: every relative link resolves`, () => {
    for (const link of relativeLinks(md)) {
      assert.ok(fs.existsSync(path.join(DOCS, link)), `broken link: ${link}`);
    }
  });
}
