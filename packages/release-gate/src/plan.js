// A release plan check: a dependency map, a RACI table, a risk register and a change log with impact,
// all in one file for one release. The check finds what is missing before the release does.
// It runs as one more check in the gate ("release-plan"), so a plan with a hole blocks the release.

import { isRealDate } from './change.js';

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const RACI = ['R', 'A', 'C', 'I'];
const TASK_STATUSES = ['open', 'done'];
const RISK_STATUSES = ['open', 'closed'];

/**
 * Checks the shape of the plan file and returns it. Throws a message that names the field.
 * The rules about what the plan says (who is accountable, what depends on what) are in checkPlan.
 * @param {unknown} input
 */
export function validatePlan(input) {
  const fail = (msg) => { throw new Error(`plan file: ${msg}`); };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('must be a JSON object with release, releaseTask, roles, tasks, decisionPoints, risks and changes');
  const p = /** @type {Record<string, any>} */ (input);
  if (!isText(p.release)) fail('"release" must be a non-empty string');
  if (!isText(p.releaseTask)) fail('"releaseTask" must name the task that is the release itself');
  if (!Array.isArray(p.roles) || p.roles.length === 0 || !p.roles.every(isText)) fail('"roles" must list at least one role');
  if (!Array.isArray(p.tasks) || p.tasks.length === 0) fail('"tasks" must list at least one task');
  for (const [i, t] of p.tasks.entries()) {
    if (!isText(t?.id) || !isText(t?.name)) fail(`tasks[${i}] needs an "id" and a "name"`);
    if (!isRealDate(t.dueDate)) fail(`task ${t.id}: "dueDate" must be a date such as 2026-11-22`);
    if (!TASK_STATUSES.includes(t.status)) fail(`task ${t.id}: "status" must be open or done`);
    if (!Array.isArray(t.dependsOn) || !t.dependsOn.every(isText)) fail(`task ${t.id}: "dependsOn" must be a list of task ids (it may be empty)`);
    if (t.raci === null || typeof t.raci !== 'object' || Array.isArray(t.raci)) fail(`task ${t.id}: "raci" must map each role to R, A, C or I`);
    for (const [role, letter] of Object.entries(t.raci)) if (!RACI.includes(/** @type {string} */ (letter))) fail(`task ${t.id}: the RACI letter for ${role} must be R, A, C or I`);
  }
  const ids = p.tasks.map((t) => t.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) fail(`task id ${twice} is used twice`);
  const duplicate = (kind, list) => { const ids = list.map((x) => x.id); const d = ids.find((id, i) => ids.indexOf(id) !== i); if (d) fail(`${kind} id ${d} is used twice`); };
  if (!Array.isArray(p.decisionPoints)) fail('"decisionPoints" must be a list');
  for (const [i, d] of p.decisionPoints.entries()) {
    if (!isText(d?.id) || !isText(d?.name)) fail(`decisionPoints[${i}] needs an "id" and a "name"`);
    if (!isRealDate(d.date)) fail(`decision ${d.id}: "date" must be a date such as 2026-11-22`);
  }
  duplicate('decision', p.decisionPoints);
  if (!Array.isArray(p.risks)) fail('"risks" must be a list (it may be empty)');
  for (const [i, r] of p.risks.entries()) {
    if (!isText(r?.id) || !isText(r?.text)) fail(`risks[${i}] needs an "id" and a "text"`);
    if (!SEVERITIES.includes(r.severity)) fail(`risk ${r.id}: "severity" must be one of ${SEVERITIES.join(', ')}`);
    if (!RISK_STATUSES.includes(r.status)) fail(`risk ${r.id}: "status" must be open or closed`);
    for (const key of ['linkedTests', 'linkedDefects']) if (r[key] !== undefined && !(Array.isArray(r[key]) && r[key].every(isText))) fail(`risk ${r.id}: "${key}" must be a list of ids`);
  }
  duplicate('risk', p.risks);
  if (!Array.isArray(p.changes)) fail('"changes" must be a list (it may be empty)');
  for (const [i, c] of p.changes.entries()) {
    if (!isText(c?.id) || !isText(c?.name)) fail(`changes[${i}] needs an "id" and a "name"`);
    if (!Array.isArray(c.tests) || !c.tests.every(isText)) fail(`change ${c.id}: "tests" must be a list of test ids (it may be empty)`);
  }
  duplicate('change', p.changes);
  return p;
}

/**
 * Every task the release depends on, directly or not.
 * @param {Map<string, any>} byId
 * @param {string} from
 */
function ancestors(byId, from) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const t = byId.get(stack.pop());
    for (const dep of t?.dependsOn ?? []) if (!seen.has(dep) && byId.has(dep)) { seen.add(dep); stack.push(dep); }
  }
  return seen;
}

/** One dependency cycle as a path (A -> B -> A), or null. */
function findCycle(byId) {
  const state = new Map(); // 1 = on the current path, 2 = finished
  const path = [];
  const visit = (id) => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const dep of byId.get(id).dependsOn) {
      if (!byId.has(dep) || dep === id) continue; // a task that depends on itself is reported on its own
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of byId.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * What is wrong with the plan. Each problem has a code a test can pin and a message a person can act on.
 * @param {unknown} planInput
 * @param {{ today?: string, knownTests?: Set<string>, knownDefects?: Set<string> }} [options]
 *   today: a date such as 2026-11-22. knownTests and knownDefects: the ids a risk may link to.
 * @returns {Array<{ code: string, id: string, message: string }>}
 */
export function checkPlan(planInput, { today, knownTests, knownDefects } = {}) {
  if (today !== undefined && !isRealDate(today)) throw new Error('plan check: today must be a date such as 2026-11-22');
  const plan = validatePlan(planInput);
  const problems = [];
  const add = (code, id, message) => problems.push({ code, id, message });
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));

  if (!byId.has(plan.releaseTask)) add('release-task-unknown', plan.releaseTask, `releaseTask ${plan.releaseTask} is not one of the tasks`);

  for (const t of plan.tasks) {
    for (const dep of t.dependsOn) {
      if (dep === t.id) add('depends-on-itself', t.id, `${t.id} depends on itself`);
      else if (!byId.has(dep)) add('unknown-dependency', t.id, `${t.id} depends on ${dep}, which is not a task in the plan`);
      else if (t.dueDate < byId.get(dep).dueDate) add('due-before-dependency', t.id, `${t.id} is due ${t.dueDate}, before ${dep} which it needs (due ${byId.get(dep).dueDate})`);
    }
  }
  const cycle = findCycle(byId);
  if (cycle) add('cycle', cycle[0], `the tasks depend on each other in a circle: ${cycle.join(' -> ')}`);

  if (byId.has(plan.releaseTask) && !cycle) {
    const upstream = ancestors(byId, plan.releaseTask);
    for (const t of plan.tasks) if (t.id !== plan.releaseTask && !upstream.has(t.id)) add('not-upstream', t.id, `${t.id} is not needed by the release, so nothing waits for it (a missing dependency?)`);
  }

  for (const t of plan.tasks) {
    const letters = Object.entries(t.raci);
    for (const [role] of letters) if (!plan.roles.includes(role)) add('raci-unknown-role', t.id, `${t.id}: ${role} is not one of the plan's roles`);
    const accountable = letters.filter(([, l]) => l === 'A');
    if (accountable.length === 0) add('raci-no-accountable', t.id, `${t.id} has nobody accountable`);
    if (accountable.length > 1) add('raci-many-accountable', t.id, `${t.id} has ${accountable.length} accountable roles (${accountable.map(([r]) => r).join(', ')}); there must be exactly one`);
    if (!letters.some(([, l]) => l === 'R')) add('raci-no-responsible', t.id, `${t.id} has nobody responsible for doing the work`);
  }

  for (const r of plan.risks) {
    if (r.status !== 'open') continue;
    if (!isText(r.owner)) add('risk-no-owner', r.id, `risk ${r.id} has no owner`);
    else if (!plan.roles.includes(r.owner)) add('risk-unknown-owner', r.id, `risk ${r.id}: ${r.owner} is not one of the plan's roles`);
    if (['critical', 'high'].includes(r.severity) && !isText(r.mitigation)) add('risk-no-mitigation', r.id, `${r.severity} risk ${r.id} has no mitigation`);
    for (const test of r.linkedTests ?? []) if (knownTests && !knownTests.has(test)) add('risk-unknown-link', r.id, `risk ${r.id} links to test ${test}, which is not in the test results`);
    for (const defect of r.linkedDefects ?? []) if (knownDefects && !knownDefects.has(defect)) add('risk-unknown-link', r.id, `risk ${r.id} links to defect ${defect}, which is not in the defect list`);
  }

  for (const d of plan.decisionPoints) {
    if (!isText(d.decidedBy)) add('decision-no-owner', d.id, `decision ${d.id} (${d.name}) has nobody who decides it`);
    if (d.taskId !== undefined && !byId.has(d.taskId)) add('decision-unknown-task', d.id, `decision ${d.id} (${d.name}) is tied to task ${d.taskId}, which is not in the plan`);
    if (!isText(d.successMeasure)) add('decision-no-measure', d.id, `decision ${d.id} (${d.name}) has no success measure`);
  }
  const releaseDue = byId.get(plan.releaseTask)?.dueDate;
  if (!plan.decisionPoints.length) add('no-decision-point', plan.release, 'the plan has no decision point, so nobody is named to say go or no-go');
  for (const d of plan.decisionPoints) if (releaseDue && d.date > releaseDue) add('decision-after-release', d.id, `decision ${d.id} is on ${d.date}, after the release on ${releaseDue}`);

  for (const c of plan.changes) if (c.tests.length === 0) add('change-no-tests', c.id, `change ${c.id} (${c.name}) names no tests, so nothing says what to rerun for it`);

  // Where the plan stands: every task but the release itself must be done before the release is decided.
  for (const t of plan.tasks) {
    if (t.id === plan.releaseTask || t.status === 'done') continue;
    if (today && t.dueDate < today) add('late', t.id, `${t.id} (${t.name}) was due ${t.dueDate} and is not done`);
    else add('not-done', t.id, `${t.id} (${t.name}) is not done`);
  }
  return problems;
}

/** The tests to rerun for a release: every test named by a change, once, in order. */
export function testsToRerun(planInput) {
  const plan = validatePlan(planInput);
  return [...new Set(plan.changes.flatMap((c) => c.tests))].sort();
}

/**
 * The plan as one check for the gate.
 * @param {unknown} planInput
 * @param {Parameters<typeof checkPlan>[1]} [options]
 */
export function fromPlan(planInput, options) {
  const problems = checkPlan(planInput, options);
  return {
    name: 'release-plan',
    kind: 'check',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `plan for ${/** @type {any} */ (planInput).release} is complete`
      : `${problems.length} problem(s): ${problems.slice(0, 3).map((p) => p.message).join('; ')}${problems.length > 3 ? `; and ${problems.length - 3} more` : ''}`,
  };
}

// Free text inside a quoted mermaid label: the characters that start an entity or a tag are written as entities.
const label = (text) => String(text).replace(/#/g, '#35;').replace(/&/g, '#amp;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/"/g, '#quot;').replace(/\s*[\n\r]\s*/g, ' ').trim();
// A pipe would add a column to a table row.
const cell = (text) => oneLine(text).replace(/\|/g, '\\|');
const oneLine = (text) => String(text).replace(/\s*\n\s*/g, ' ').trim();

/**
 * The status report: what is late and why, the risks still open, the problems in the plan, what to rerun,
 * and the dependency map. Written for a reader who has not seen the plan.
 * @param {unknown} planInput
 * @param {{ today?: string, knownTests?: Set<string>, knownDefects?: Set<string> }} [options]
 */
export function formatPlanReport(planInput, options = {}) {
  const plan = validatePlan(planInput);
  const problems = checkPlan(plan, options);
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  // Node names are generated, so ids such as T-1 and T_1, or a word mermaid keeps (end, graph), cannot merge or break the map.
  const nodes = new Map(plan.tasks.map((t, i) => [t.id, `n${i}`]));
  const node = (id) => nodes.get(id);
  const done = plan.tasks.filter((t) => t.status === 'done').length;
  const late = problems.filter((p) => p.code === 'late');
  const openRisks = plan.risks.filter((r) => r.status === 'open').sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const rerun = testsToRerun(plan);
  const lines = [
    `# Release plan status: ${oneLine(plan.release)}`,
    '',
    ...(options.today ? [`As of ${options.today}.`, ''] : []),
    `**${done} of ${plan.tasks.length} tasks done.** ${problems.length === 0 ? 'The plan has no problems.' : `${problems.length} problem(s) to fix.`}`,
    '',
    '## Late',
    '',
    ...(late.length
      ? late.map((p) => {
        const t = byId.get(p.id);
        const waiting = plan.tasks.filter((o) => o.dependsOn.includes(t.id)).map((o) => o.id);
        return `- ${oneLine(p.message)}${waiting.length ? `; ${waiting.join(', ')} wait${waiting.length === 1 ? 's' : ''} for it` : ''}.`;
      })
      : [options.today ? '- Nothing is late.' : '- Not checked: give today\'s date to see what is late.']),
    '',
    '## Open risks',
    '',
    ...(openRisks.length
      ? ['| Risk | Severity | Owner | Mitigation |', '|---|---|---|---|', ...openRisks.map((r) => `| ${cell(r.id)}: ${cell(r.text)} | ${r.severity} | ${r.owner ? cell(r.owner) : '**no owner**'} | ${r.mitigation ? cell(r.mitigation) : '**none**'} |`)]
      : ['- No open risks.']),
    '',
    '## Problems in the plan',
    '',
    ...(problems.length ? problems.map((p) => `- \`${p.code}\`: ${oneLine(p.message)}`) : ['- None.']),
    '',
    '## Tests to rerun for this release',
    '',
    ...(rerun.length ? [rerun.join(', ')] : ['None named.']),
    '',
    '## Dependency map',
    '',
    '```mermaid',
    'flowchart LR',
    ...plan.tasks.map((t) => `  ${node(t.id)}["${label(t.id)}: ${label(t.name)}${t.status === 'done' ? ' (done)' : ''}"]`),
    ...plan.tasks.flatMap((t) => t.dependsOn.filter((d) => byId.has(d)).map((d) => `  ${node(d)} --> ${node(t.id)}`)),
    ...plan.tasks.filter((t) => t.status === 'done').map((t) => `  style ${node(t.id)} fill:#dafbe1,stroke:#116329,color:#116329`),
    '```',
    '',
  ];
  return lines.join('\n');
}
