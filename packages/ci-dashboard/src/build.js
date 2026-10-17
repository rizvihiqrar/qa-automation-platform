#!/usr/bin/env node
// Builds the dashboard: fetch recent CI runs, compute metrics, write HTML + JSON.
//   node src/build.js --out site [--repo owner/name] [--limit 40]
// Token: GITHUB_TOKEN, or the signed-in GitHub CLI (`gh auth token`).

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fetchRuns } from './github.js';
import { computeMetrics } from './metrics.js';
import { renderHtml } from './render.js';
import { buildReports, renderReportsPage } from './reports.js';
import { writeTraceability, TRACED_SUITE, RESULTS_FILE } from './traceability.js';

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : def; };

const repo = arg('--repo', process.env.GITHUB_REPOSITORY || 'rizvihiqrar/qa-automation-platform');
const out = arg('--out', 'site');
const limit = Number(arg('--limit', '40'));
// --reports <dir>: downloaded report-* artifacts of one CI run (--reports-run <id>),
// published under <out>/reports. See src/reports.js.
const reportsDir = arg('--reports', null);
const reportsRun = Number(arg('--reports-run', '0'));
// --plan <test-plan.md>: also publish the traceability matrix under <out>/reports/traceability,
// with results from that run's qa-practice-api report. See src/traceability.js.
const planFile = arg('--plan', null);

let token = process.env.GITHUB_TOKEN;
if (!token) {
  // One command string: Windows needs a shell to find gh, and Node warns when args are passed with a shell.
  const gh = spawnSync('gh auth token', { encoding: 'utf8', shell: true });
  token = gh.status === 0 ? gh.stdout.trim() : undefined;
}

try {
  const runs = await fetchRuns({ repo, token, limit });
  const metrics = computeMetrics(runs);
  fs.mkdirSync(out, { recursive: true });
  const generatedAt = new Date().toISOString();

  let reportsHref = null;
  if (reportsDir) {
    const run = runs.find((r) => r.id === reportsRun) ?? null;
    const rows = buildReports({ rawDir: reportsDir, outDir: path.join(out, 'reports'), jobs: run?.jobs ?? [] });
    fs.mkdirSync(path.join(out, 'reports'), { recursive: true });
    let traceabilityHref = null;
    if (planFile) {
      const traced = rows.find((r) => r.name === TRACED_SUITE);
      const m = writeTraceability({
        planFile,
        resultsFile: path.join(reportsDir, `report-${TRACED_SUITE}`, ...RESULTS_FILE.split('/')),
        outDir: path.join(out, 'reports', 'traceability'),
        repo, run, generatedAt,
        reportHref: traced?.entry && !traced.withheld ? `../${TRACED_SUITE}/${traced.entry}` : null,
      });
      traceabilityHref = 'traceability/';
      console.log(`traceability: ${m.totals.passing}/${m.totals.requirements} requirements passing, ${m.totals.passed}/${m.totals.cases} cases passed${m.hasResults ? '' : ' (no results found)'}`);
    }
    fs.writeFileSync(path.join(out, 'reports', 'index.html'), renderReportsPage(rows, { repo, run, generatedAt, traceabilityHref }));
    reportsHref = 'reports/';
    for (const r of rows) {
      console.log(`report ${r.name}: ${r.withheld ? `WITHHELD (${r.withheld})` : r.entry ? `published ${r.entry}${r.redactions ? `, ${r.redactions} redacted` : ''}` : 'no page'}`);
    }
  }

  fs.writeFileSync(path.join(out, 'index.html'), renderHtml(metrics, { repo, generatedAt, reportsHref }));
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(`${metrics.overall.runs} runs, ${metrics.overall.packages} packages, ${metrics.overall.flakyJobs} flaky job result(s) -> ${path.join(out, 'index.html')}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
