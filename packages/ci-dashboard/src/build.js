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

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : def; };

const repo = arg('--repo', process.env.GITHUB_REPOSITORY || 'rizvihiqrar/qa-automation-platform');
const out = arg('--out', 'site');
const limit = Number(arg('--limit', '40'));

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
  fs.writeFileSync(path.join(out, 'index.html'), renderHtml(metrics, { repo, generatedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(`${metrics.overall.runs} runs, ${metrics.overall.packages} packages, ${metrics.overall.flakyJobs} flaky job result(s) -> ${path.join(out, 'index.html')}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
