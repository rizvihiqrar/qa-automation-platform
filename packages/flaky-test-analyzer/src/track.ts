#!/usr/bin/env node
// Usage: node src/track.ts <runs-dir> [--out flaky-tests.json] [--repo owner/name] [--apply]
//
// <runs-dir> holds one folder per CI run, named by run ID, each with that run's
// Playwright JSON report(s). Prints the flaky tests and the issue changes they
// call for. With --apply (needs --repo and GITHUB_TOKEN), makes those changes.
// Without it, nothing is changed; open issues are still read when a token is set.
import { readdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeRuns, type NamedReport, type PlaywrightReport } from './analyze.ts';
import { buildFlakyList, planIssues, summaryMarkdown, type Issue } from './tracker.ts';
import { client } from './github.ts';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const dir = args[0];
const out = option('--out');
const repo = option('--repo');
const apply = args.includes('--apply');
const token = process.env.GITHUB_TOKEN;

if (!dir || dir.startsWith('--') || (apply && (!repo || !token))) {
  console.error('Usage: node src/track.ts <runs-dir> [--out flaky-tests.json] [--repo owner/name] [--apply]');
  console.error('--apply needs --repo and the GITHUB_TOKEN environment variable.');
  process.exit(2);
}

// Run folders oldest first: CI run IDs increase over time.
const runDirs = (await readdir(dir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
const reports: NamedReport[] = [];
for (const run of runDirs) {
  for (const file of (await readdir(path.join(dir, run))).filter((f) => f.endsWith('.json'))) {
    reports.push({ run, report: JSON.parse(await readFile(path.join(dir, run, file), 'utf8')) as PlaywrightReport });
  }
}
const runs = [...new Set(reports.map((r) => r.run))];
if (runs.length === 0) {
  console.error(`No run folders with .json reports found in ${dir}`);
  process.exit(2);
}

const rows = analyzeRuns(reports);
const list = buildFlakyList(rows, runs, new Date().toISOString());
if (out) await writeFile(out, JSON.stringify(list, null, 2) + '\n');

const github = repo && token ? client({ repo, token }) : undefined;
const open: Issue[] = github ? await github.openIssues() : [];
const link = repo ? (run: string) => `[run ${run}](https://github.com/${repo}/actions/runs/${run})` : undefined;
const actions = planIssues(list, rows, open, link);

if (apply && github) {
  await github.ensureLabel();
  await github.apply(actions);
}

const markdown = summaryMarkdown(list, actions, apply);
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
