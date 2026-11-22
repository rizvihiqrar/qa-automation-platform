import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPlan, formatPlanReport, fromPlan, testsToRerun, validatePlan } from '../src/plan.js';
import { decide } from '../src/gate.js';
import { parseArgs } from '../src/cli.js';
import { buildPlanReports, PAGE_DAY } from '../examples/build-memos.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const here = (...p) => fileURLToPath(new URL(path.posix.join('..', ...p), import.meta.url));
const valid = () => JSON.parse(fs.readFileSync(here('examples', 'plan-1.4.1.json'), 'utf8'));
/** @type {{ today?: string, knownTests?: Set<string>, knownDefects?: Set<string> }} */
const KNOWN = {
  today: '2026-11-22',
  knownTests: new Set(['PL-01', 'PL-02', 'PF-01', 'PF-02', 'DS-01', 'DS-02', 'DS-03', 'TT-01']),
  knownDefects: new Set(['DEF-12', 'DEF-14', 'DEF-9']),
};
const codes = (plan, options = KNOWN) => checkPlan(plan, options).map((p) => p.code);
const task = (plan, id) => plan.tasks.find((t) => t.id === id);

test('the committed example plan has no problems (no false alert on a good plan)', () => {
  assert.deepEqual(checkPlan(valid(), KNOWN), []);
  assert.equal(fromPlan(valid(), KNOWN).passed, true);
  assert.equal(fromPlan(valid(), KNOWN).detail, 'plan for 1.4.1 is complete');
});

// Each mutation puts one known fault into the good plan. The check has to name it.
/** @type {Array<[string, string, (p: any) => void]>} */
const SEEDED = [
  ['unknown-dependency', 'a task depends on a task that is not in the plan', (p) => { task(p, 'T2').dependsOn.push('T9'); }],
  ['depends-on-itself', 'a task depends on itself', (p) => { task(p, 'T3').dependsOn.push('T3'); }],
  ['decision-unknown-task', 'a decision tied to a task that is not in the plan', (p) => { p.decisionPoints[0].taskId = 'T99'; }],
  ['cycle', 'two tasks wait for each other', (p) => { task(p, 'T1').dependsOn.push('T2'); }],
  ['due-before-dependency', 'a task is due before the task it needs', (p) => { task(p, 'T2').dueDate = '2026-11-19'; }],
  ['not-upstream', 'a task that the release does not wait for (a missing dependency)', (p) => { task(p, 'T6').dependsOn = ['T2', 'T5']; }],
  ['release-task-unknown', 'the release task is not in the plan', (p) => { p.releaseTask = 'T99'; }],
  ['raci-no-accountable', 'a task with nobody accountable', (p) => { task(p, 'T1').raci['Release manager'] = 'C'; }],
  ['raci-many-accountable', 'a task with two accountable roles', (p) => { task(p, 'T1').raci.Developer = 'A'; }],
  ['raci-no-responsible', 'a task with nobody responsible', (p) => { task(p, 'T1').raci.Developer = 'C'; }],
  ['raci-unknown-role', 'a RACI role that is not in the plan', (p) => { task(p, 'T1').raci.Intern = 'C'; }],
  ['risk-no-owner', 'an open risk with no owner', (p) => { delete p.risks[1].owner; }],
  ['risk-unknown-owner', 'a risk owned by a role that is not in the plan', (p) => { p.risks[0].owner = 'Nobody'; }],
  ['risk-no-mitigation', 'a high risk with no mitigation', (p) => { delete p.risks[1].mitigation; }],
  ['risk-unknown-link', 'a risk linked to a test that does not exist', (p) => { p.risks[0].linkedTests = ['DS-99']; }],
  ['risk-unknown-link', 'a risk linked to a defect that does not exist', (p) => { p.risks[1].linkedDefects = ['DEF-99']; }],
  ['decision-no-owner', 'a decision nobody makes', (p) => { delete p.decisionPoints[0].decidedBy; }],
  ['decision-no-measure', 'a decision with no success measure', (p) => { delete p.decisionPoints[0].successMeasure; }],
  ['decision-after-release', 'a decision made after the release', (p) => { p.decisionPoints[0].date = '2026-11-23'; }],
  ['no-decision-point', 'no decision point at all', (p) => { p.decisionPoints = []; }],
  ['change-no-tests', 'a change that names no tests', (p) => { p.changes[0].tests = []; }],
  ['not-done', 'a task before the decision that is not done', (p) => { task(p, 'T4').status = 'open'; task(p, 'T4').dueDate = '2026-11-22'; }],
  ['late', 'a task that is past its due date and not done', (p) => { task(p, 'T4').status = 'open'; task(p, 'T4').dueDate = '2026-11-20'; }],
];

for (const [code, what, seed] of SEEDED) {
  test(`seeded fault found: ${what} (${code})`, () => {
    const plan = valid();
    seed(plan);
    assert.ok(codes(plan).includes(code), `${code} was not reported; got ${codes(plan).join(', ') || 'nothing'}`);
  });
}

test('every seeded fault is found, and a closed risk does not need an owner or a mitigation', () => {
  const caught = SEEDED.filter(([code, , seed]) => { const p = valid(); seed(p); return codes(p).includes(code); });
  assert.equal(caught.length, SEEDED.length);
  const plan = valid();
  delete plan.risks[2].owner; delete plan.risks[2].mitigation;
  assert.deepEqual(codes(plan), []);
});

test('a task that depends on itself is one problem, not a cycle as well', () => {
  const plan = valid();
  task(plan, 'T3').dependsOn.push('T3');
  assert.deepEqual(codes(plan), ['depends-on-itself']);
});

test('a cycle is reported with its path, and only once', () => {
  const plan = valid();
  task(plan, 'T1').dependsOn.push('T2');
  const found = checkPlan(plan, KNOWN).filter((p) => p.code === 'cycle');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /T1 -> T2 -> T1|T2 -> T1 -> T2/);
});

test('"late" needs today\'s date; without it an open task is only "not done"', () => {
  const plan = valid();
  task(plan, 'T4').status = 'open'; task(plan, 'T4').dueDate = '2026-11-20';
  assert.deepEqual(codes(plan, { ...KNOWN, today: undefined }), ['not-done']);
  assert.deepEqual(codes(plan, { ...KNOWN, today: '2026-11-20' }), ['not-done']);
  assert.deepEqual(codes(plan, { ...KNOWN, today: '2026-11-21' }), ['late']);
});

test('the release task itself may be open: it is the decision being made', () => {
  assert.equal(task(valid(), 'T6').status, 'open');
  assert.deepEqual(codes(valid()), []);
});

test('risk links are only checked when the test and defect lists are given', () => {
  const plan = valid();
  plan.risks[0].linkedTests = ['DS-99'];
  assert.deepEqual(codes(plan, { today: '2026-11-22' }), []);
  assert.deepEqual(codes(plan, KNOWN), ['risk-unknown-link']);
});

test('tests to rerun: ten sample changes give the hand-made list', () => {
  const plan = valid();
  plan.changes = [
    ['C1', ['A-1', 'A-2']], ['C2', ['A-2', 'B-1']], ['C3', ['B-1']], ['C4', ['C-1', 'C-2', 'C-3']], ['C5', []],
    ['C6', ['A-1']], ['C7', ['D-1']], ['C8', ['C-3', 'D-1']], ['C9', ['E-1']], ['C10', ['A-2', 'E-1']],
  ].map(([id, tests]) => ({ id, name: `Change ${id}`, tests }));
  assert.deepEqual(testsToRerun(plan), ['A-1', 'A-2', 'B-1', 'C-1', 'C-2', 'C-3', 'D-1', 'E-1']);
  assert.deepEqual(testsToRerun(valid()), ['DS-01', 'DS-02', 'DS-03', 'PF-01', 'PF-02', 'PL-01', 'PL-02']);
});

test('the plan file is checked and the message names the field', () => {
  const bad = (mutate, pattern) => { const p = valid(); mutate(p); assert.throws(() => validatePlan(p), pattern); };
  assert.throws(() => validatePlan(null), /must be a JSON object/);
  bad((p) => { delete p.release; }, /"release" must be a non-empty string/);
  bad((p) => { delete p.releaseTask; }, /"releaseTask"/);
  bad((p) => { p.roles = []; }, /"roles" must list at least one role/);
  bad((p) => { p.tasks = []; }, /"tasks" must list at least one task/);
  bad((p) => { delete p.tasks[0].name; }, /tasks\[0\] needs an "id" and a "name"/);
  bad((p) => { p.tasks[1].dueDate = '2026-02-31'; }, /task T2: "dueDate" must be a date/);
  bad((p) => { p.tasks[1].status = 'wip'; }, /task T2: "status" must be open or done/);
  bad((p) => { p.tasks[1].dependsOn = 'T1'; }, /task T2: "dependsOn" must be a list/);
  bad((p) => { p.tasks[1].raci = []; }, /task T2: "raci" must map each role/);
  bad((p) => { p.tasks[1].raci['QA lead'] = 'X'; }, /the RACI letter for QA lead must be R, A, C or I/);
  bad((p) => { p.tasks[1].id = 'T1'; }, /task id T1 is used twice/);
  bad((p) => { p.decisionPoints = 'none'; }, /"decisionPoints" must be a list/);
  bad((p) => { p.decisionPoints[0].date = 'soon'; }, /decision D1: "date" must be a date/);
  bad((p) => { p.risks[0].severity = 'huge'; }, /risk K1: "severity" must be one of critical, high, medium, low/);
  bad((p) => { p.risks[0].linkedTests = 'DS-01'; }, /risk K1: "linkedTests" must be a list of ids/);
  bad((p) => { p.changes[0].tests = 'DS-01'; }, /change C1: "tests" must be a list/);
});

test('ids must be unique in every list, so two risks named K1 cannot hide behind each other', () => {
  const dup = (mutate, pattern) => { const p = valid(); mutate(p); assert.throws(() => validatePlan(p), pattern); };
  dup((p) => { p.risks[1].id = 'K1'; }, /risk id K1 is used twice/);
  dup((p) => { p.changes[1].id = 'C1'; }, /change id C1 is used twice/);
  dup((p) => { p.decisionPoints.push({ ...p.decisionPoints[0] }); }, /decision id D1 is used twice/);
});

test('a date that is not a date is refused, not compared as text', () => {
  assert.throws(() => checkPlan(valid(), { today: '2026-1-5' }), /today must be a date such as 2026-11-22/);
  assert.throws(() => fromPlan(valid(), { today: '22 Nov' }), /today must be a date/);
  assert.throws(() => checkPlan(valid(), { today: '2026-02-31' }), /today must be a date/);
});

test('the gate check says how many problems and names the first three', () => {
  const plan = valid();
  task(plan, 'T1').raci['Release manager'] = 'C';
  task(plan, 'T2').dueDate = '2026-11-19';
  plan.changes[0].tests = [];
  plan.risks[1].mitigation = '';
  const r = fromPlan(plan, KNOWN);
  assert.equal(r.passed, false);
  assert.match(r.detail, /^4 problem\(s\): /);
  assert.equal(r.detail.split('; ').length, 4);
  assert.match(r.detail, /and 1 more$/);
});

test('a plan with a hole blocks the release even when every other check passes', () => {
  const passing = [{ name: 'smoke', kind: 'tests', passed: true, detail: '3/3', counts: { passed: 3, failed: 0, flaky: 0 } }];
  const plan = valid();
  assert.equal(decide({}, [...passing, fromPlan(plan, KNOWN)]).decision, 'go');
  delete plan.risks[1].owner;
  const out = decide({}, [...passing, fromPlan(plan, KNOWN)]);
  assert.equal(out.decision, 'no-go');
  assert.match(out.reasons[0], /^release-plan: 1 problem\(s\): risk K2 has no owner/);
});

test('the status report says what is late and what waits for it', () => {
  const plan = valid();
  task(plan, 'T4').status = 'open'; task(plan, 'T4').dueDate = '2026-11-20';
  const report = formatPlanReport(plan, KNOWN);
  assert.match(report, /\*\*4 of 6 tasks done\.\*\* 1 problem\(s\) to fix\./);
  assert.match(report, /## Late\n\n- T4 \(Close the open high defect and review the rest\) was due 2026-11-20 and is not done; T5 waits for it\./);
  assert.match(report, /- `late`: T4/);
});

test('the status report says it was not checked for lateness when it has no date', () => {
  assert.match(formatPlanReport(valid(), { ...KNOWN, today: undefined }), /Not checked: give today's date/);
  assert.match(formatPlanReport(valid(), KNOWN), /- Nothing is late\./);
});

test('open risks are listed worst first, and a risk with no owner or mitigation is marked', () => {
  const plan = valid();
  delete plan.risks[1].owner; delete plan.risks[1].mitigation;
  const report = formatPlanReport(plan, KNOWN);
  const lines = report.split('\n').filter((l) => l.startsWith('| K'));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\| K2: .* \| high \| \*\*no owner\*\* \| \*\*none\*\* \|$/);
  assert.match(lines[1], /^\| K1: .* \| medium \| QA lead \|/);
  assert.doesNotMatch(report, /K3:/);
});

test('the dependency map is a mermaid flowchart with one edge per dependency and the done tasks marked', () => {
  const report = formatPlanReport(valid(), KNOWN);
  const map = report.split('```mermaid\n')[1].split('```')[0];
  assert.match(map, /^flowchart LR/);
  // nodes are n0 to n5 in task order: T1 is n0, T2 is n1, and so on
  for (const edge of ['n0 --> n1', 'n0 --> n2', 'n0 --> n3', 'n1 --> n4', 'n3 --> n4', 'n1 --> n5', 'n2 --> n5', 'n4 --> n5']) assert.ok(map.includes(`  ${edge}`), edge);
  assert.equal(map.split(' --> ').length - 1, 8);
  assert.match(map, /n0\["T1: Fix the two responses that did not match the API description \(done\)"\]/);
  assert.match(map, /n5\["T6: Release gate decision"\]/);
  assert.match(map, /style n0 fill:/);
  assert.doesNotMatch(map, /style n5/);
});

test('task names cannot break the map: quotes, tags, brackets and hashes are written as entities', () => {
  const plan = valid();
  task(plan, 'T1').name = 'Say "hi" <b>[api]</b> #3 & more\nthen stop';
  const report = formatPlanReport(plan, KNOWN);
  assert.match(report, /n0\["T1: Say #quot;hi#quot; #lt;b#gt;\[api\]#lt;\/b#gt; #35;3 #amp; more then stop \(done\)"\]/);
  const map = report.split('```mermaid\n')[1].split('```')[0];
  const nodeLine = map.split('\n').find((l) => l.includes('n0['));
  assert.doesNotMatch(nodeLine, /[<>]/);
  assert.equal(nodeLine.split('"').length - 1, 2, "only the two quotes that wrap the label");
});

test('ids such as T-1 and T_1, or a word mermaid keeps, stay separate nodes', () => {
  const plan = valid();
  task(plan, 'T2').id = 'T-1';
  task(plan, 'T3').id = 'T_1';
  task(plan, 'T4').id = 'end';
  for (const t of plan.tasks) t.dependsOn = t.dependsOn.map((d) => ({ T2: 'T-1', T3: 'T_1', T4: 'end' }[d] ?? d));
  plan.decisionPoints[0].taskId = 'T6';
  const map = formatPlanReport(plan, { today: '2026-11-22' }).split('```mermaid\n')[1].split('```')[0];
  assert.equal(new Set([...map.matchAll(/^  (n\d+)\[/gm)].map((m) => m[1])).size, 6);
  assert.doesNotMatch(map, /\bend\b -->|--> end\b/);
  assert.ok(map.includes('n1["T-1: ') && map.includes('n2["T_1: '));
  assert.ok(map.includes('  n0 --> n1') && map.includes('  n0 --> n2'));
});

test('a pipe in any cell of the risk table cannot add a column', () => {
  const plan = valid();
  plan.risks[0].text = 'A | B';
  plan.risks[0].owner = 'QA lead';
  plan.roles.push('QA | Dev');
  plan.risks[1].owner = 'QA | Dev';
  plan.risks[1].id = 'K|2';
  plan.risks[1].mitigation = 'x | y';
  const rows = formatPlanReport(plan, { today: '2026-11-22' }).split('\n').filter((l) => /^\| (K\\\||K1)/.test(l));
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.replace(/\\\|/g, '').split('|').length, 6, row);
  assert.match(rows[0], /K\\\|2: .* \| QA \\\| Dev \| x \\\| y \|$/);
});

test('the committed example report equals what the code builds (run node examples/build-memos.js after a change)', () => {
  for (const [file, text] of Object.entries(buildPlanReports())) {
    assert.equal(fs.readFileSync(here('examples', 'plans', file), 'utf8').replace(/\r\n/g, '\n'), text, `${file} is out of date: run node examples/build-memos.js`);
  }
  assert.equal(PAGE_DAY, '2026-11-22');
});

// The command line, with real files.
function runCli(extra, planFile = here('examples', 'plan-1.4.1.json')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  const status = path.join(dir, 'status.md');
  const res = spawnSync(process.execPath, [CLI, '--check', `ok=${here('examples', 'contract-1.4.1.json')}`, '--plan', planFile, '--status', status, '--today', '2026-11-22', ...extra], { encoding: 'utf8' });
  return { res, status: fs.existsSync(status) ? fs.readFileSync(status, 'utf8') : null, dir };
}

test('command line: a good plan passes, shows as a check and writes the status report', () => {
  const { res, status } = runCli([]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /\| release-plan \| pass \| plan for 1.4.1 is complete \|/);
  assert.match(status, /^# Release plan status: 1.4.1/);
});

test('command line: a plan with a hole exits 1 and the table names the problem', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-bad-'));
  const bad = valid();
  delete bad.risks[1].owner;
  const file = path.join(dir, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(bad));
  const { res, status } = runCli([], file);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /\| release-plan \| fail \| 1 problem\(s\): risk K2 has no owner/);
  assert.match(status, /\*\*no owner\*\*/);
});

test('command line: a risk that links to a test the readiness file does not have is found when both are given', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-link-'));
  const bad = valid();
  bad.risks[0].linkedTests = ['DS-99'];
  const file = path.join(dir, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(bad));
  const ok = runCli(['--readiness', here('examples', 'readiness-1.4.1.json'), '--page', path.join(dir, 'p.html'), '--release', here('examples', 'release-1.4.1.json'), '--memo', path.join(dir, 'm.md')], here('examples', 'plan-1.4.1.json'));
  assert.doesNotMatch(ok.res.stdout, /release-plan \| fail/);
  const found = runCli(['--readiness', here('examples', 'readiness-1.4.1.json'), '--page', path.join(dir, 'p.html'), '--release', here('examples', 'release-1.4.1.json'), '--memo', path.join(dir, 'm.md')], file);
  assert.match(found.res.stdout, /\| release-plan \| fail \| 1 problem\(s\): risk K1 links to test DS-99/);
});

test('command line: a plan file that is missing or has a bad field is a failed check, and no report is written', () => {
  const missing = runCli([], path.join(os.tmpdir(), 'no-such-plan.json'));
  assert.equal(missing.res.status, 1);
  assert.match(missing.res.stdout, /\| release-plan \| fail \| result file not found/);
  assert.match(missing.status, /^# Release plan status\n\nThe plan could not be read: result file not found: /);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-field-'));
  const bad = valid(); bad.tasks[0].dueDate = 'soon';
  const file = path.join(dir, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(bad));
  const field = runCli([], file);
  assert.equal(field.res.status, 1);
  assert.match(field.res.stdout, /\| release-plan \| fail \| plan file: task T1: "dueDate"/);
  assert.match(field.status, /The plan could not be read: plan file: task T1: "dueDate"/);
});

test('arguments: the status report needs the plan', () => {
  const contract = ['--check', 'a=b.json'];
  assert.throws(() => parseArgs([...contract, '--status', 's.md']), /--status needs --plan/);
  assert.throws(() => parseArgs([...contract, '--plan']), /--plan needs a file path/);
  assert.doesNotThrow(() => parseArgs([...contract, '--plan', 'p.json']));
  assert.doesNotThrow(() => parseArgs([...contract, '--plan', 'p.json', '--status', 's.md']));
});
