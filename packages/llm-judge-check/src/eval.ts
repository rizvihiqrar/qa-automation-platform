// Runs the promptfoo evals (replaying the recorded runs, no model calls) and checks
// each against this package's own scoring: for every run, promptfoo's passed tests
// must equal this package's count of passing answers. Two independent
// implementations of the same count; if they differ, one of them is wrong.
//   promptfooconfig.yaml          Day 40: verdict vs human label
//   promptfooconfig-redteam.yaml  Day 41: format, verdict, citation and forbidden text
//
// Also fails on any promptfoo error, which is what the replay provider returns when a
// rendered prompt differs from the one the judge answered.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRuns } from './record.ts';
import { loadRedRuns } from './redteam-record.ts';
import { scoreRun } from './redteam-report.ts';
import { PKG, sha256 } from './render.ts';
import { loadKey } from './review-sheet.ts';

interface PromptfooRow {
  success: boolean;
  prompt: { raw: string };
  vars: { id: string };
  error?: string;
  provider: { id: string; label?: string };
}

function promptfoo(config: string): PromptfooRow[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptfoo-'));
  const out = path.join(dir, 'results.json');
  const res = spawnSync(
    `npx promptfoo eval -c ${config} --no-cache --no-progress-bar --no-write --no-table -o "${out}"`,
    {
      cwd: PKG,
      shell: true,
      encoding: 'utf8',
      env: { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_DISABLE_UPDATE: '1', PROMPTFOO_CONFIG_DIR: dir },
    },
  );
  // promptfoo exits non-zero when any assertion fails, which disagreements always do here
  if (!fs.existsSync(out)) {
    console.error(res.stdout, res.stderr);
    throw new Error(`promptfoo wrote no results for ${config}`);
  }
  const rows = (JSON.parse(fs.readFileSync(out, 'utf8')) as { results: { results: PromptfooRow[] } }).results.results;
  fs.rmSync(dir, { recursive: true, force: true });
  return rows;
}

function check(
  config: string,
  runs: { name: string; prompts: Record<string, string> }[],
  own: (name: string) => { passed: number; total: number },
  problems: string[],
): number {
  const rows = promptfoo(config);
  for (const e of rows.filter((r) => r.error && !r.success && /prompt differs|has no answer/.test(r.error))) {
    problems.push(`${config} ${e.provider.label}: ${e.error}`);
  }
  // Don't rely on the provider's own check: hash every prompt promptfoo rendered and
  // compare it with the prompt the judge answered.
  for (const row of rows) {
    const recorded = runs.find((r) => r.name === row.provider.label)?.prompts[row.vars.id];
    if (sha256(row.prompt.raw) !== recorded) problems.push(`${config} ${row.provider.label} ${row.vars.id}: promptfoo rendered a different prompt from the one the judge answered`);
  }
  const configured = new Set(rows.map((r) => r.provider.label));
  for (const run of runs) {
    if (!configured.has(run.name)) problems.push(`${run.name} is recorded but not in ${config}`);
    const mine = own(run.name);
    const theirs = rows.filter((r) => r.provider.label === run.name && r.success).length;
    const total = rows.filter((r) => r.provider.label === run.name).length;
    console.log(`${config} ${run.name}: promptfoo ${theirs}/${total} passed, own scoring ${mine.passed}/${mine.total}`);
    if (mine.passed !== theirs || total !== mine.total) problems.push(`${config} ${run.name}: promptfoo ${theirs}/${total}, own scoring ${mine.passed}/${mine.total}`);
  }
  return rows.length;
}

const problems: string[] = [];
const key = loadKey();
const runs = loadRuns();
const day40 = check('promptfooconfig.yaml', runs, (name) => {
  const run = runs.find((r) => r.name === name)!;
  return { passed: run.answers.filter((a) => a.verdict === key[a.id]?.label).length, total: run.answers.length };
}, problems);

const red = loadRedRuns();
const day41 = check('promptfooconfig-redteam.yaml', red, (name) => {
  const s = scoreRun(red.find((r) => r.name === name)!);
  return { passed: s.filter((x) => x.pass).length, total: s.length };
}, problems);

if (problems.length) {
  console.error(`\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`\npromptfoo and this package agree on all ${runs.length + red.length} runs (${day40 + day41} replayed answers, every prompt identical to the recorded one)`);
