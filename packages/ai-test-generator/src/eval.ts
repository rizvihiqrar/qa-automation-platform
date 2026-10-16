#!/usr/bin/env node
/**
 * Eval: how good are the generated tests?
 *
 *   node src/eval.ts --generate [--label 2026-10-17] [--inputs examples/input]
 *       Calls the Claude API once per feature file (costs money), saves the raw
 *       specs to eval/runs/<label>/, then scores them.
 *
 *   node src/eval.ts --score eval/runs/<label>
 *       Re-scores saved specs. No API calls.
 *
 * Scoring = the review rules + one Playwright run with no retries. Results go to
 * results.json and REPORT.md, plus FIXES.md for a person to fill in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { generateTests, DEFAULT_MODEL, type MessagesClient } from './generator.ts';
import { reviewSpec } from './review.ts';
import { collectRunResults, summarize, toMarkdown, fixesTemplate, stripLocalPaths, type PlaywrightReport, type Summary } from './evalReport.ts';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface EvalArgs {
  generate: boolean;
  label: string;
  inputs: string;
  runDir: string;
}

export function parseEvalArgs(argv: string[], today = new Date().toISOString().slice(0, 10)): EvalArgs {
  const get = (flag: string): string | null => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] ?? null : null; };
  const generate = argv.includes('--generate');
  const score = get('--score');
  if (generate === Boolean(score)) throw new Error('Use exactly one of --generate or --score <run-dir>');
  const label = get('--label') ?? today;
  return {
    generate,
    label,
    inputs: get('--inputs') ?? 'examples/input',
    runDir: score ?? path.join('eval', 'runs', label),
  };
}

async function generateAll(inputs: string, runDir: string): Promise<void> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic() as unknown as MessagesClient;
  fs.mkdirSync(runDir, { recursive: true });
  const files = fs.readdirSync(inputs).filter((f) => f.endsWith('.txt')).sort();
  let model = DEFAULT_MODEL;
  for (const file of files) {
    const name = path.basename(file, '.txt');
    process.stdout.write(`Generating ${name} ... `);
    const result = await generateTests(client, fs.readFileSync(path.join(inputs, file), 'utf8').trim());
    model = result.model;
    fs.writeFileSync(path.join(runDir, `${name}.spec.js`), result.code, 'utf8');
    console.log(`done (${result.usage.output_tokens} output tokens)`);
  }
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({ model, generatedAt: new Date().toISOString() }, null, 2));
}

function runPlaywright(runDir: string): PlaywrightReport {
  const reportFile = path.join(runDir, 'playwright-results.json');
  // One command string: npx needs a shell on Windows, and Node warns when args are passed with shell: true.
  const res = spawnSync('npx playwright test --config eval/playwright.eval.config.js', {
    cwd: PACKAGE_DIR,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, EVAL_RUN_DIR: path.resolve(runDir), PLAYWRIGHT_JSON_OUTPUT_NAME: path.resolve(reportFile) },
  });
  if (!fs.existsSync(reportFile)) throw new Error(`Playwright produced no report:\n${res.stderr || res.stdout}`);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as PlaywrightReport;
  fs.writeFileSync(reportFile, JSON.stringify(stripLocalPaths(report), null, 2));
  return report;
}

export function scoreRun(runDir: string, label: string): Summary {
  const specs = fs.readdirSync(runDir).filter((f) => f.endsWith('.spec.js')).sort();
  if (specs.length === 0) throw new Error(`No .spec.js files in ${runDir}`);

  const results = collectRunResults(runPlaywright(runDir));
  const features = specs.map((file) => ({
    feature: path.basename(file, '.spec.js'),
    review: reviewSpec(fs.readFileSync(path.join(runDir, file), 'utf8')),
    run: results.get(file) ?? null,
  }));

  const summary = summarize(features);
  const metaFile = path.join(runDir, 'meta.json');
  const model: string = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')).model : 'unknown';

  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(runDir, 'REPORT.md'), toMarkdown(summary, { label, model }));
  const fixes = path.join(runDir, 'FIXES.md');
  if (!fs.existsSync(fixes)) fs.writeFileSync(fixes, fixesTemplate(summary, { label }));
  return summary;
}

async function main(): Promise<void> {
  const args = parseEvalArgs(process.argv.slice(2));
  if (args.generate) await generateAll(args.inputs, args.runDir);
  const { totals } = scoreRun(args.runDir, args.label);
  console.log(`\nReview passed: ${totals.reviewPassed}/${totals.features}. ` +
    `Tests passed: ${totals.testsPassed}/${totals.testsRun}. Usable as-is: ${totals.clean}/${totals.features}.`);
  console.log(`Report: ${path.join(args.runDir, 'REPORT.md')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
