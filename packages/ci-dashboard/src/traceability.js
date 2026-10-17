#!/usr/bin/env node
// Traceability matrix: risk → requirement → designed test case → latest result.
//
// The requirements and cases come from the test plan (docs/test-strategy/test-plan.md),
// where every case row names its requirement. The results come from the Playwright
// JSON report of the suite that runs those cases (qa-practice-api), matched on the
// case ID each test title starts with. The Dashboard workflow publishes the matrix
// next to the HTML reports after every CI run on main; it also runs locally:
//   node src/traceability.js --plan ../../docs/test-strategy/test-plan.md \
//     --results ../qa-practice-api/reports/results.json --out site/traceability
//
// scripts/test-plan.test.mjs reads the plan with the same parser, so the plan check
// and the matrix can't disagree about what the plan says.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { esc, day, PAGE_STYLE } from './render.js';

/** The suite whose report holds the designed cases, and where its JSON results land. */
export const TRACED_SUITE = 'qa-practice-api';
export const RESULTS_FILE = 'reports/results.json';

/**
 * @typedef {{ id: string, text: string, risks: string[] }} Requirement
 * @typedef {{ id: string, req: string, input: string, expected: string, technique: string | null }} PlanCase
 * @typedef {'passed' | 'failed' | 'flaky' | 'skipped' | 'no result'} CaseResult
 * @typedef {'failing' | 'incomplete' | 'flaky' | 'passing'} RequirementStatus
 */

/**
 * "| TC-EP-01 | REQ-01 | input | expected |" rows, with the "## " section (the
 * technique) each sits under.
 * @param {string} md
 * @returns {PlanCase[]}
 */
export function planCases(md) {
  /** @type {PlanCase[]} */
  const cases = [];
  /** @type {string | null} */
  let technique = null;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) technique = line.slice(3).replace(/:.*/, '');
    const m = line.match(/^\| (TC-[A-Z]+-\d{2}) \| (REQ-\d{2}) \| (.+) \| (.+) \|$/);
    if (m) cases.push({ id: m[1], req: m[2], input: m[3], expected: m[4], technique });
  }
  return cases;
}

/**
 * "| REQ-01 | text | R-05, R-11 |" rows.
 * @param {string} md
 * @returns {Requirement[]}
 */
export function requirements(md) {
  return [...md.matchAll(/^\| (REQ-\d{2}) \| (.+) \| (R-\d{2}(?:, R-\d{2})*) \|$/gm)]
    .map(([, id, text, risks]) => ({ id, text, risks: risks.split(', ') }));
}

const CASE_ID = /^(TC-[A-Z]+-\d{2})\b/;

/** Playwright's per-test status, in the matrix's words. */
const PW_STATUS = /** @type {Record<string, CaseResult>} */ ({
  expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped',
});

// When one case ID shows up more than once (a second project, a copied test), the
// worst result stands.
const CASE_RANK = /** @type {CaseResult[]} */ (['failed', 'no result', 'skipped', 'flaky', 'passed']);
/** @param {CaseResult} a @param {CaseResult} b */
const worse = (a, b) => (CASE_RANK.indexOf(a) <= CASE_RANK.indexOf(b) ? a : b);

/**
 * The result of every test in a Playwright JSON report whose title starts with a
 * case ID, plus a count of the tests that don't name one.
 * @param {any} report Playwright's JSON reporter output
 * @returns {{ byCase: Map<string, { result: CaseResult, count: number }>, untraced: number, startedAt: string | null }}
 */
export function caseResults(report) {
  /** @type {Map<string, { result: CaseResult, count: number }>} */
  const byCase = new Map();
  let untraced = 0;
  /** @param {any} suite */
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const id = String(spec.title ?? '').match(CASE_ID)?.[1];
      for (const t of spec.tests ?? []) {
        if (!id) { untraced += 1; continue; }
        const result = PW_STATUS[t.status] ?? 'failed';
        const seen = byCase.get(id);
        byCase.set(id, seen ? { result: worse(seen.result, result), count: seen.count + 1 } : { result, count: 1 });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report?.suites ?? []) walk(suite);
  return { byCase, untraced, startedAt: report?.stats?.startTime ?? null };
}

/**
 * A requirement fails if any of its cases failed; it is incomplete if any case
 * has no result or was skipped (so a passing count can't hide a missing test);
 * flaky if any case passed only on a retry; otherwise passing.
 * @param {CaseResult[]} results
 * @returns {RequirementStatus}
 */
export function requirementStatus(results) {
  if (results.length === 0) return 'incomplete';
  if (results.includes('failed')) return 'failing';
  if (results.includes('no result') || results.includes('skipped')) return 'incomplete';
  if (results.includes('flaky')) return 'flaky';
  return 'passing';
}

/**
 * @typedef {{ id: string, req: string, input: string, expected: string, technique: string | null, result: CaseResult }} MatrixCase
 * @typedef {{ id: string, text: string, risks: string[], status: RequirementStatus, cases: MatrixCase[] }} MatrixRow
 * @typedef {{
 *   rows: MatrixRow[],
 *   cases: MatrixCase[],
 *   hasResults: boolean,
 *   startedAt: string | null,
 *   untraced: number,
 *   unplanned: string[],
 *   duplicated: string[],
 *   orphanCases: string[],
 *   totals: { requirements: number, passing: number, cases: number } & Record<CaseResult, number>,
 * }} Matrix
 */

/**
 * Joins the plan with a report. With no report (the suite didn't run, or its
 * artifact is missing) every case shows "no result" and no requirement passes.
 * @param {string} planMd
 * @param {any | null} report
 * @returns {Matrix}
 */
export function buildMatrix(planMd, report) {
  const reqs = requirements(planMd);
  const planned = planCases(planMd);
  const { byCase, untraced, startedAt } = report ? caseResults(report) : { byCase: new Map(), untraced: 0, startedAt: null };

  /** @type {MatrixCase[]} */
  const cases = planned.map((c) => ({ ...c, result: byCase.get(c.id)?.result ?? 'no result' }));
  const rows = reqs.map((r) => {
    const own = cases.filter((c) => c.req === r.id);
    return { ...r, cases: own, status: requirementStatus(own.map((c) => c.result)) };
  });

  const plannedIds = new Set(planned.map((c) => c.id));
  const known = new Set(reqs.map((r) => r.id));
  const totals = { requirements: rows.length, passing: rows.filter((r) => r.status === 'passing').length, cases: cases.length,
    passed: 0, failed: 0, flaky: 0, skipped: 0, 'no result': 0 };
  for (const c of cases) totals[c.result] += 1;

  return {
    rows,
    cases,
    hasResults: Boolean(report),
    startedAt,
    untraced,
    // Tests that name a case the plan doesn't have: renamed or deleted from the plan.
    unplanned: [...byCase.keys()].filter((id) => !plannedIds.has(id)).sort(),
    duplicated: [...byCase].filter(([, v]) => v.count > 1).map(([id]) => id).sort(),
    // Cases citing a requirement that isn't listed would otherwise vanish from the matrix.
    orphanCases: cases.filter((c) => !known.has(c.req)).map((c) => c.id),
    totals,
  };
}

// Plan text is Markdown; only its inline code spans are kept.
/** @param {string} text */
export const inline = (text) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');

const CASE_STYLE = /** @type {Record<CaseResult, { cls: string, icon: string }>} */ ({
  passed: { cls: 'good', icon: '✓' },
  flaky: { cls: 'warning', icon: '!' },
  failed: { cls: 'critical', icon: '✕' },
  skipped: { cls: 'muted', icon: '–' },
  'no result': { cls: 'muted', icon: '?' },
});

const REQ_STYLE = /** @type {Record<RequirementStatus, { cls: string, icon: string, label: string }>} */ ({
  passing: { cls: 'good', icon: '✓', label: 'Passing' },
  flaky: { cls: 'warning', icon: '!', label: 'Passing, flaky' },
  incomplete: { cls: 'warning', icon: '?', label: 'Incomplete' },
  failing: { cls: 'critical', icon: '✕', label: 'Failing' },
});

const EXTRA_STYLE = `
.cases { display: flex; flex-wrap: wrap; gap: 4px; }
.case { position: relative; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; padding: 2px 6px; border-radius: 4px; box-shadow: 0 0 0 1px var(--ring); white-space: nowrap; }
.case::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 0; background: var(--text-muted); }
.case.good::before { background: var(--good); } .case.warning::before { background: var(--warning); } .case.critical::before { background: var(--critical); }
.case.critical { box-shadow: 0 0 0 2px var(--critical); }
.status.muted .icon { background: var(--text-muted); }
td.id { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; }
.problems { margin: 0; padding-left: 20px; }
`;

/**
 * @param {Matrix} m
 * @param {{ repo: string, run: { id: number, number: number, event: string, createdAt: string, sha?: string } | null, generatedAt: string, reportHref?: string | null }} meta
 */
export function renderTraceabilityPage(m, { repo, run, generatedAt, reportHref = null }) {
  const ref = run?.sha ?? 'main';
  const docs = `https://github.com/${esc(repo)}/blob/${esc(ref)}/docs/test-strategy`;
  const runText = run
    ? `CI run <a href="https://github.com/${esc(repo)}/actions/runs/${run.id}">#${run.number}</a> (${esc(run.event)}, ${esc(day(run.createdAt))}${run.sha ? `, commit <code>${esc(run.sha.slice(0, 7))}</code>` : ''})`
    : 'a local run';
  const t = m.totals;
  const chip = (/** @type {MatrixCase} */ c) =>
    `<span class="case ${CASE_STYLE[c.result].cls}" title="${esc(`${c.input} → ${c.expected}: ${c.result}`)}">${esc(c.id)}<span class="visually-hidden"> ${esc(c.result)}</span></span>`;
  const status = (/** @type {{ cls: string, icon: string }} */ s, /** @type {string} */ label) =>
    `<span class="status ${s.cls}"><span class="icon" aria-hidden="true">${s.icon}</span>${esc(label)}</span>`;

  /** @type {string[]} */
  const problems = [];
  if (!m.hasResults) problems.push(`No ${TRACED_SUITE} results were found for this run, so no requirement can be shown as passing.`);
  if (m.unplanned.length) problems.push(`Tests name cases that aren't in the plan: ${m.unplanned.map(esc).join(', ')}.`);
  if (m.duplicated.length) problems.push(`Case IDs used by more than one test (the worst result is shown): ${m.duplicated.map(esc).join(', ')}.`);
  if (m.orphanCases.length) problems.push(`Cases citing a requirement the plan doesn't list: ${m.orphanCases.map(esc).join(', ')}.`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Traceability Matrix</title>
<style>${PAGE_STYLE}${EXTRA_STYLE}
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }</style>
</head>
<body>
<div class="viz-root">
<div class="wrap">
  <h1>Traceability Matrix</h1>
  <p class="lede">Each requirement of qa-practice-api, the designed test cases that check it, and their results in ${runText}. Requirements and cases come from the <a href="${docs}/test-plan.md">test plan</a>, risks from the <a href="${docs}/README.md">test strategy</a>. <a href="../">Back to the reports</a>. Generated ${esc(day(generatedAt))}.</p>
  <div class="tiles">
    <div class="tile"><div class="label">Requirements passing</div><div class="value">${t.passing} / ${t.requirements}</div></div>
    <div class="tile"><div class="label">Cases passed</div><div class="value">${t.passed} / ${t.cases}</div></div>
    <div class="tile"><div class="label">Cases failed</div><div class="value">${t.failed}</div></div>
    <div class="tile"><div class="label">Cases with no result</div><div class="value">${t['no result'] + t.skipped}</div></div>
  </div>
  ${problems.length ? `<section class="card wide"><h2>Needs attention</h2><ul class="problems">${problems.map((p) => `<li>${p}</li>`).join('')}</ul></section>` : ''}
  <section class="card wide">
    <h2>Requirements</h2>
    <p class="sub">A requirement passes only when every one of its cases passed. One failed case makes it failing; a case with no result makes it incomplete.</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Requirement</th><th>What it says</th><th>Risks</th><th>Cases</th><th>Status</th></tr></thead>
      <tbody>
      ${m.rows.map((r) => `<tr><td class="id">${esc(r.id)}</td><td>${inline(r.text)}</td><td class="id">${r.risks.map(esc).join(', ')}</td><td><div class="cases">${r.cases.map(chip).join('')}</div></td><td>${status(REQ_STYLE[r.status], REQ_STYLE[r.status].label)}</td></tr>`).join('\n      ')}
      </tbody>
    </table>
    </div>
  </section>
  <section class="card wide">
    <h2>All ${t.cases} cases</h2>
    <p class="sub">${reportHref ? `Failure details are in the <a href="${esc(reportHref)}">${TRACED_SUITE} report</a>. ` : ''}${m.untraced} other test${m.untraced === 1 ? '' : 's'} in the suite ${m.untraced === 1 ? 'is' : 'are'} route-level checks written before the plan and aren't tied to a requirement.</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Case</th><th>Technique</th><th>Requirement</th><th>Input</th><th>Expected</th><th>Result</th></tr></thead>
      <tbody>
      ${m.cases.map((c) => `<tr><td class="id">${esc(c.id)}</td><td>${esc(c.technique ?? '')}</td><td class="id">${esc(c.req)}</td><td>${inline(c.input)}</td><td>${inline(c.expected)}</td><td>${status(CASE_STYLE[c.result], c.result)}</td></tr>`).join('\n      ')}
      </tbody>
    </table>
    </div>
  </section>
  <footer>Published by packages/ci-dashboard (src/traceability.js).</footer>
</div>
</div>
</body>
</html>
`;
}

/**
 * Writes index.html and matrix.json into outDir. A missing or unreadable results
 * file is the "no results" case, not an error: the page then says so.
 * @param {{ planFile: string, resultsFile: string | null, outDir: string, repo: string, run?: any, generatedAt?: string, reportHref?: string | null }} options
 * @returns {Matrix}
 */
export function writeTraceability({ planFile, resultsFile, outDir, repo, run = null, generatedAt = new Date().toISOString(), reportHref = null }) {
  let report = null;
  if (resultsFile && fs.existsSync(resultsFile)) {
    try { report = JSON.parse(fs.readFileSync(resultsFile, 'utf8')); } catch { report = null; }
  }
  const matrix = buildMatrix(fs.readFileSync(planFile, 'utf8'), report);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), renderTraceabilityPage(matrix, { repo, run, generatedAt, reportHref }));
  fs.writeFileSync(path.join(outDir, 'matrix.json'), JSON.stringify(matrix, null, 2));
  return matrix;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (/** @type {string} */ flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : undefined; };
  const planFile = arg('--plan');
  if (!planFile) {
    console.error('usage: traceability.js --plan <test-plan.md> [--results <results.json>] [--out <dir>]');
    process.exit(2);
  }
  const m = writeTraceability({
    planFile,
    resultsFile: arg('--results') ?? null,
    outDir: arg('--out') ?? 'site/traceability',
    repo: process.env.GITHUB_REPOSITORY || 'rizvihiqrar/qa-automation-platform',
  });
  const t = m.totals;
  console.log(`${t.passing}/${t.requirements} requirements passing; cases: ${t.passed} passed, ${t.failed} failed, ${t.flaky} flaky, ${t.skipped} skipped, ${t['no result']} no result`);
  for (const r of m.rows.filter((x) => x.status !== 'passing')) console.log(`  ${r.id} ${r.status}: ${r.cases.filter((c) => c.result !== 'passed').map((c) => `${c.id} ${c.result}`).join(', ')}`);
}
