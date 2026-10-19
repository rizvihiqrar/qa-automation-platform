// Runs the promptfoo evals (replaying the recorded runs, no model calls) and checks
// each against this package's own scoring: for every run, promptfoo's passed tests
// must equal this package's count of passing answers. Two independent
// implementations of the same count; if they differ, one of them is wrong.
//   promptfooconfig.yaml          Day 40: verdict vs human label
//   promptfooconfig-redteam.yaml  Day 41: format, verdict, citation and forbidden text
//
// Also fails on any promptfoo error, which is what the replay provider returns when a
// rendered prompt differs from the one the judge answered, and (Day 42) on any result
// whose trace ID isn't the one derived from its suite, run, case and prompt.
//
// src/traces.ts runs the same evaluation with Langfuse configured.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuns } from './record.ts';
import { loadRedRuns } from './redteam-record.ts';
import { scoreRun } from './redteam-report.ts';
import { PKG, sha256 } from './render.ts';
import { loadKey } from './review-sheet.ts';
import { traceIdFor, type Suite } from './trace.ts';

export interface PromptfooRow {
  success: boolean;
  prompt: { raw: string };
  vars: { id: string; label: string };
  error?: string;
  provider: { id: string; label?: string };
  response?: { metadata?: { traceId?: string; traced?: boolean } };
  gradingResult?: { reason?: string } | null;
}

// Asynchronous, so this process stays responsive while promptfoo runs (the unit tests
// serve a fake Langfuse from it, which the provider calls from promptfoo's process).
async function promptfoo(config: string): Promise<PromptfooRow[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptfoo-'));
  const out = path.join(dir, 'results.json');
  const child = spawn(
    `npx promptfoo eval -c ${config} --no-cache --no-progress-bar --no-write --no-table -o "${out}"`,
    {
      cwd: PKG,
      shell: true,
      env: { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_DISABLE_UPDATE: '1', PROMPTFOO_CONFIG_DIR: dir },
    },
  );
  const res = { stdout: '', stderr: '' };
  child.stdout.on('data', (c: Buffer) => { res.stdout += c.toString(); });
  child.stderr.on('data', (c: Buffer) => { res.stderr += c.toString(); });
  await new Promise((resolve) => child.on('close', resolve));
  // promptfoo exits non-zero when any assertion fails, which disagreements always do here
  if (!fs.existsSync(out)) {
    console.error(res.stdout, res.stderr);
    throw new Error(`promptfoo wrote no results for ${config}`);
  }
  // The provider's warnings (a trace it couldn't send) are worth seeing in the log.
  for (const line of `${res.stdout}\n${res.stderr}`.split('\n')) if (/trace not sent/.test(line)) console.warn(line);
  const rows = (JSON.parse(fs.readFileSync(out, 'utf8')) as { results: { results: PromptfooRow[] } }).results.results;
  fs.rmSync(dir, { recursive: true, force: true });
  return rows;
}

export interface Checked {
  config: string;
  suite: Suite;
  runs: { name: string; model: string; prompts: Record<string, string> }[];
  rows: PromptfooRow[];
}

async function check(
  config: string,
  suite: Suite,
  runs: { name: string; model: string; prompts: Record<string, string> }[],
  own: (name: string) => { passed: number; total: number },
  problems: string[],
): Promise<Checked> {
  const rows = await promptfoo(config);
  for (const e of rows.filter((r) => r.error && !r.success && /prompt differs|has no answer/.test(r.error))) {
    problems.push(`${config} ${e.provider.label}: ${e.error}`);
  }
  // Don't rely on the provider's own check: hash every prompt promptfoo rendered and
  // compare it with the prompt the judge answered.
  for (const row of rows) {
    const recorded = runs.find((r) => r.name === row.provider.label)?.prompts[row.vars.id];
    if (sha256(row.prompt.raw) !== recorded) {
      problems.push(`${config} ${row.provider.label} ${row.vars.id}: promptfoo rendered a different prompt from the one the judge answered`);
      continue;
    }
    // The link from a test to its trace: derived here independently of the provider.
    const want = traceIdFor(suite, row.provider.label!, row.vars.id, recorded);
    const got = row.response?.metadata?.traceId;
    if (got !== want) problems.push(`${config} ${row.provider.label} ${row.vars.id}: trace ID ${got ?? '(none)'}, expected ${want}`);
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
  return { config, suite, runs, rows };
}

/** Both evals, checked. `problems` is empty when everything agrees. */
export async function evaluate(): Promise<{ problems: string[]; checked: Checked[] }> {
  const problems: string[] = [];
  const key = loadKey();
  const runs = loadRuns();
  const day40 = await check('promptfooconfig.yaml', 'day40', runs, (name) => {
    const run = runs.find((r) => r.name === name)!;
    return { passed: run.answers.filter((a) => a.verdict === key[a.id]?.label).length, total: run.answers.length };
  }, problems);

  const red = loadRedRuns();
  const day41 = await check('promptfooconfig-redteam.yaml', 'redteam', red, (name) => {
    const s = scoreRun(red.find((r) => r.name === name)!);
    return { passed: s.filter((x) => x.pass).length, total: s.length };
  }, problems);
  return { problems, checked: [day40, day41] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, checked } = await evaluate();
  if (problems.length) {
    console.error(`\n${problems.join('\n')}`);
    process.exit(1);
  }
  const runs = checked.reduce((n, c) => n + c.runs.length, 0);
  const rows = checked.reduce((n, c) => n + c.rows.length, 0);
  console.log(`\npromptfoo and this package agree on all ${runs} runs (${rows} replayed answers, every prompt identical to the recorded one, every trace ID as derived)`);
}
