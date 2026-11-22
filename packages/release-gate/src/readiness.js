// A release readiness page: one page per release, built from files the repo already has.
// The page is a view of the gate. The three readiness checks below go through the same
// decide() as every other check, so the page can never say GO when the gate says NO-GO.

import { CHANGE_WORDS, reviewStatus } from './change.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const DEFAULT_MAX_OPEN_DEFECTS = { critical: 0, high: 0 };
const TEST_STATUSES = ['pass', 'fail', 'quarantined'];
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Checks the readiness file and returns it. Throws a message that names the field.
 * @param {unknown} input
 */
export function validateReadiness(input) {
  const fail = (msg) => { throw new Error(`readiness file: ${msg}`); };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('must be a JSON object with requirements, defects and security');
  const d = /** @type {Record<string, any>} */ (input);
  if (!Array.isArray(d.requirements) || d.requirements.length === 0) fail('"requirements" must list at least one requirement');
  d.requirements.forEach((r, i) => {
    if (!isText(r?.id) || !isText(r?.title)) fail(`requirements[${i}] needs an "id" and a "title"`);
    if (!Array.isArray(r.tests)) fail(`requirement ${r.id}: "tests" must be a list (it may be empty)`);
    for (const t of r.tests) {
      if (!isText(t?.id)) fail(`requirement ${r.id}: every test needs an "id"`);
      if (!TEST_STATUSES.includes(t.status)) fail(`requirement ${r.id}, test ${t.id}: "status" must be one of ${TEST_STATUSES.join(', ')}`);
    }
  });
  if (!Array.isArray(d.defects)) fail('"defects" must be a list (it may be empty)');
  d.defects.forEach((x, i) => {
    if (!isText(x?.id) || !isText(x?.title)) fail(`defects[${i}] needs an "id" and a "title"`);
    if (!SEVERITIES.includes(x.severity)) fail(`defect ${x.id}: "severity" must be one of ${SEVERITIES.join(', ')}`);
    if (!['open', 'closed'].includes(x.status)) fail(`defect ${x.id}: "status" must be open or closed`);
  });
  const duplicate = (ids) => ids.find((id, i) => ids.indexOf(id) !== i);
  const dupReq = duplicate(d.requirements.map((r) => r.id));
  if (dupReq) fail(`requirement id ${dupReq} is used twice`);
  const dupTest = duplicate(d.requirements.flatMap((r) => r.tests.map((x) => x.id)));
  if (dupTest) fail(`test id ${dupTest} is used twice`);
  const dupDefect = duplicate(d.defects.map((x) => x.id));
  if (dupDefect) fail(`defect id ${dupDefect} is used twice`);
  if (d.security === null || typeof d.security !== 'object' || Array.isArray(d.security)) fail('"security" must have an "audit" and a "zap" result');
  for (const name of ['audit', 'zap']) {
    const s = d.security[name];
    if (s !== undefined && (!['pass', 'fail'].includes(s?.status) || !isText(s?.detail))) fail(`security.${name} needs a "status" of pass or fail and a "detail"`);
  }
  return d;
}

/** Where each requirement stands, from its tests only (a quarantined test is not evidence). */
export function requirementStatus(requirement) {
  if (requirement.tests.some((t) => t.status === 'fail')) return 'failing';
  if (!requirement.tests.some((t) => t.status === 'pass')) return 'not tested';
  return 'covered';
}

export function openDefectCounts(data) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const d of data.defects) if (d.status === 'open') counts[d.severity] += 1;
  return counts;
}

/**
 * The three checks the gate judges: requirements, open-defects and security.
 * @param {unknown} input
 * @param {{ maxOpenDefects?: Record<string, number> }} [policy]
 */
export function fromReadiness(input, policy = {}) {
  const data = validateReadiness(input);
  const limits = policy.maxOpenDefects ?? DEFAULT_MAX_OPEN_DEFECTS;

  const states = data.requirements.map((r) => ({ id: r.id, status: requirementStatus(r) }));
  const covered = states.filter((s) => s.status === 'covered').length;
  const failing = states.filter((s) => s.status === 'failing').map((s) => s.id);
  const untested = states.filter((s) => s.status === 'not tested').map((s) => s.id);
  const reqProblems = [failing.length ? `failing: ${failing.join(', ')}` : '', untested.length ? `not tested: ${untested.join(', ')}` : ''].filter(Boolean);

  const counts = openDefectCounts(data);
  const over = SEVERITIES.filter((s) => s in limits && counts[s] > limits[s]);

  const security = ['audit', 'zap'].map((name) => ({ name, result: data.security[name] }));
  const secProblems = security.filter((s) => s.result?.status !== 'pass').map((s) => (s.result ? `${s.name} failed` : `${s.name} was not reported`));

  return [
    { name: 'requirements', kind: 'check', passed: reqProblems.length === 0, detail: `${covered}/${states.length} requirements covered${reqProblems.length ? `; ${reqProblems.join('; ')}` : ''}` },
    { name: 'open-defects', kind: 'check', passed: over.length === 0, detail: over.length ? over.map((s) => `${counts[s]} open ${s} (limit ${limits[s]})`).join('; ') : `${SEVERITIES.reduce((n, s) => n + counts[s], 0)} open, none over the limits` },
    { name: 'security', kind: 'check', passed: secProblems.length === 0, detail: secProblems.length ? secProblems.join('; ') : 'dependency audit and ZAP baseline both passed' },
  ];
}

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// A word as well as a colour, so the page does not rely on colour alone.
const CHIP = { pass: ['ok', 'Passed'], fail: ['bad', 'Failed'], missing: ['warn', 'Did not run'], covered: ['ok', 'Covered'], failing: ['bad', 'Failing'], 'not tested': ['warn', 'Not tested'] };
const chip = (key) => `<span class="chip ${CHIP[key][0]}">${CHIP[key][1]}</span>`;

const STYLE = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1b1f24;--muted:#57606a;--line:#d8dee4;--ok:#116329;--okbg:#dafbe1;--bad:#a40e26;--badbg:#ffebe9;--warn:#7d4e00;--warnbg:#fff1c2}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--text:#e6edf3;--muted:#9da7b3;--line:#30363d;--ok:#7ee787;--okbg:#12361c;--bad:#ff9492;--badbg:#4a1620;--warn:#f2cc60;--warnbg:#3d2f06}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif}
main{max-width:56rem;margin:0 auto;padding:1rem}h1{font-size:1.5rem;margin:.5rem 0}h2{font-size:1.1rem;margin:1.5rem 0 .5rem}
.banner{border-radius:8px;padding:1rem;font-weight:600;font-size:1.2rem}.banner.go{background:var(--okbg);color:var(--ok)}.banner.nogo{background:var(--badbg);color:var(--bad)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.5rem 1rem;overflow-x:auto}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
.chip{display:inline-block;border-radius:1rem;padding:0 .6rem;font-size:.85rem;font-weight:600}.chip.ok{background:var(--okbg);color:var(--ok)}.chip.bad{background:var(--badbg);color:var(--bad)}.chip.warn{background:var(--warnbg);color:var(--warn)}
.muted{color:var(--muted)}ul{margin:.25rem 0;padding-left:1.25rem}
`;

const table = (head, rows) => `<div class="card"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

/**
 * @param {{ decision: string, reasons: string[], checks: Array<{ name: string, status: string, detail: string }>, change?: any }} outcome
 * @param {unknown} readinessInput
 * @param {{ version: string, date: string }} release
 * @param {{ today?: string }} [options] "today" decides whether a review is late; leave it out and no verdict is given
 */
export function formatPage(outcome, readinessInput, release, { today } = {}) {
  const data = validateReadiness(readinessInput);
  const go = outcome.decision === 'go';
  const counts = openDefectCounts(data);
  const quarantined = data.requirements.flatMap((r) => r.tests.filter((t) => t.status === 'quarantined').map((t) => [esc(t.id), `${esc(r.id)} ${esc(r.title)}`]));
  const openDefects = data.defects.filter((d) => d.status === 'open');
  const sections = [
    `<h1>Release readiness: ${esc(release.version)}</h1>`,
    `<p class="muted">Date: ${esc(release.date)}</p>`,
    `<div class="banner ${go ? 'go' : 'nogo'}">${go ? '✅ GO, the release can go out' : '⛔ NO-GO, the release is not ready'}</div>`,
  ];
  if (!go) sections.push(`<h2>Why</h2><div class="card"><ul>${outcome.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`);

  sections.push('<h2>Checks</h2>', table(['Check', 'Result', 'Detail'], outcome.checks.map((c) => [esc(c.name), chip(c.status), esc(c.detail)])));

  sections.push('<h2>Requirements and their tests</h2>', table(['Requirement', 'Status', 'Tests'], data.requirements.map((r) => [
    `${esc(r.id)} ${esc(r.title)}`, chip(requirementStatus(r)),
    r.tests.length ? r.tests.map((t) => `${esc(t.id)} (${esc(t.status)})`).join(', ') : '<span class="muted">none</span>',
  ])));

  sections.push('<h2>Open defects by severity</h2>', table(['Severity', 'Open'], SEVERITIES.map((s) => [s, String(counts[s])])));
  if (openDefects.length) sections.push(`<div class="card"><ul>${openDefects.map((d) => `<li>${esc(d.id)} (${esc(d.severity)}): ${esc(d.title)}</li>`).join('')}</ul></div>`);

  sections.push('<h2>Quarantined tests</h2>', quarantined.length ? table(['Test', 'Requirement'], quarantined) : '<p class="muted">None.</p>');

  sections.push('<h2>Security</h2>', table(['Scan', 'Result', 'Detail'], ['audit', 'zap'].map((n) => {
    const s = data.security[n];
    return [n === 'audit' ? 'Dependency audit' : 'ZAP baseline', chip(s ? s.status : 'missing'), s ? esc(s.detail) : 'not reported'];
  })));

  if (outcome.change) {
    const c = outcome.change;
    const state = today ? reviewStatus(c, today) : null;
    sections.push(
      '<h2>Change type</h2>',
      `<div class="card"><p><strong>${esc(c.type)} change.</strong> ${esc(CHANGE_WORDS[c.type])}</p><ul>`
      + `<li>Planned for: ${esc(c.change.plannedFor)}</li><li>Approved by: ${c.change.approvedBy ? esc(c.change.approvedBy) : 'nobody named'}</li>`
      + c.obligations.map((o) => `<li>${esc(o)}${state === 'overdue' ? ' <span class="chip bad">Late</span>' : ''}</li>`).join('')
      + '</ul></div>',
    );
  }

  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Release readiness ${esc(release.version)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<main>\n${sections.join('\n')}\n</main>\n</body>\n</html>\n`;
}
