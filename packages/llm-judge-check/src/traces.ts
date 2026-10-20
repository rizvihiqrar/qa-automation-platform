// Day 42: runs both promptfoo evals with Langfuse configured, then checks that every
// AI test produced exactly one trace and that the trace holds what the test saw.
//
// node src/traces.ts [--out <dir>]
//   needs LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY (the CI job
//   starts a self-hosted Langfuse with docker compose: langfuse/docker-compose.yml)
//
// 1. The eval runs exactly as `npm run eval` does (same checks), and the replay
//    provider sends each judge call as a generation (src/trace.ts).
// 2. Each promptfoo assertion result is sent as an evaluator in the same trace.
// 3. Every observation is read back from Langfuse and compared with what this package
//    expects, worked out from the recorded runs, not from what was sent: one
//    generation and one evaluator per test, the prompt's hash, the reply byte for byte,
//    the model, the run as the session, and promptfoo's pass or fail. A trace no test
//    explains is a failure too.
// 4. The comparison is then given four things that must fail (a test with no trace,
//    a changed reply, a flipped result, a wrong API key) to show it can.
// 5. With --out, the traces as Langfuse stored them are written as a report page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, type Checked } from './eval.ts';
import { loadRuns } from './record.ts';
import { loadRedRuns } from './redteam-record.ts';
import { sha256 } from './render.ts';
import {
  evaluatorSpan, getJson, langfuseFromEnv, listObservations, sendSpans, spanIdFor, traceIdFor,
  type Langfuse, type Observation, type Suite,
} from './trace.ts';
import { renderTracesPage } from './traces-page.ts';

export interface Expected {
  traceId: string;
  suite: Suite;
  run: string;
  caseId: string;
  model: string;
  promptSha: string;
  /** The reply as recorded: Day 40's parsed answer as JSON, Day 41's raw text. */
  output: string;
  pass: boolean;
  label: string;
  reason: string;
}

/** What Langfuse should hold, from the recorded runs plus promptfoo's verdict on each. */
export function expectedTraces(checked: Checked[]): Expected[] {
  const day40 = new Map(loadRuns().map((r) => [r.name, r]));
  const red = new Map(loadRedRuns().map((r) => [r.name, r]));
  return checked.flatMap((c) => c.rows.map((row): Expected => {
    const run = row.provider.label!;
    const caseId = row.vars.id;
    let model: string, promptSha: string, output: string;
    if (c.suite === 'day40') {
      const r = day40.get(run)!;
      const { verdict, test, reason } = r.answers.find((a) => a.id === caseId)!;
      [model, promptSha, output] = [r.model, r.prompts[caseId]!, JSON.stringify({ verdict, test, reason })];
    } else {
      const r = red.get(run)!;
      [model, promptSha, output] = [r.model, r.prompts[caseId]!, r.replies.find((x) => x.id === caseId)!.raw];
    }
    return {
      traceId: traceIdFor(c.suite, run, caseId, promptSha),
      suite: c.suite, run, caseId, model, promptSha, output,
      pass: row.success,
      label: row.vars.label,
      reason: row.gradingResult?.reason ?? (row.success ? 'All assertions passed' : 'failed'),
    };
  }));
}

const text = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

/** Every way Langfuse's copy differs from what the tests expect. Empty means all match. */
export function compareTraces(expected: Expected[], observations: Observation[]): string[] {
  const problems: string[] = [];
  const byTrace = new Map<string, Observation[]>();
  for (const o of observations) byTrace.set(o.traceId, [...(byTrace.get(o.traceId) ?? []), o]);
  const want = new Set(expected.map((e) => e.traceId));
  if (want.size !== expected.length) problems.push(`${expected.length - want.size} test(s) share a trace ID with another test`);

  for (const e of expected) {
    const at = `${e.suite} ${e.run} ${e.caseId} (trace ${e.traceId})`;
    const obs = byTrace.get(e.traceId) ?? [];
    if (!obs.length) { problems.push(`${at}: no trace in Langfuse`); continue; }
    const gens = obs.filter((o) => o.type === 'GENERATION');
    const evals = obs.filter((o) => o.type === 'EVALUATOR');
    const other = obs.filter((o) => o.type !== 'GENERATION' && o.type !== 'EVALUATOR');
    if (gens.length !== 1 || evals.length !== 1 || other.length) {
      problems.push(`${at}: ${gens.length} generation(s), ${evals.length} evaluator(s), ${other.length} other observation(s); expected 1, 1, 0`);
    }
    const gen = gens[0];
    if (gen) {
      if (gen.id !== spanIdFor(e.traceId, 'generation')) problems.push(`${at}: generation ID ${gen.id}`);
      if (gen.sessionId !== e.run) problems.push(`${at}: session ${gen.sessionId}, expected ${e.run}`);
      if (gen.model !== e.model) problems.push(`${at}: model ${gen.model}, expected ${e.model}`);
      if (sha256(text(gen.input)) !== e.promptSha) problems.push(`${at}: the traced prompt is not the one the judge answered`);
      if (text(gen.output) !== e.output) problems.push(`${at}: the traced reply differs from the recorded one`);
    }
    const ev = evals[0];
    if (ev) {
      if (ev.parentObservationId !== spanIdFor(e.traceId, 'generation')) problems.push(`${at}: the evaluator's parent is ${ev.parentObservationId}, not the generation`);
      let pass: unknown;
      try { pass = (JSON.parse(text(ev.output)) as { pass?: unknown }).pass; } catch { pass = undefined; }
      if (pass !== e.pass) problems.push(`${at}: traced result ${String(pass)}, promptfoo ${e.pass}`);
    }
  }
  for (const [traceId, obs] of byTrace) {
    if (!want.has(traceId)) problems.push(`trace ${traceId} (${obs[0]?.name ?? '?'}, session ${obs[0]?.sessionId ?? '?'}): no test explains it`);
  }
  return problems;
}

/** The comparison must fail on each of these, or it isn't checking anything. */
export async function selfTest(expected: Expected[], observations: Observation[], lf: Langfuse): Promise<string[]> {
  const failures: string[] = [];
  const must = (name: string, problems: string[]) => {
    if (!problems.length) failures.push(`self-test: ${name} went unnoticed`);
    else console.log(`self-test: ${name}: caught (${problems[0]})`);
  };
  const [first, second, third] = expected;
  must('a test with no trace', compareTraces([...expected, { ...first!, caseId: 'J99', traceId: traceIdFor(first!.suite, first!.run, 'J99', first!.promptSha) }], observations));
  must('a changed reply', compareTraces(expected.map((e) => (e === second ? { ...e, output: `${e.output} ` } : e)), observations));
  must('a flipped result', compareTraces(expected.map((e) => (e === third ? { ...e, pass: !e.pass } : e)), observations));
  try {
    await listObservations({ ...lf, secretKey: `${lf.secretKey}-wrong` });
    failures.push('self-test: a wrong secret key was accepted');
  } catch (err) {
    console.log(`self-test: a wrong secret key: refused (${(err as Error).message.slice(0, 60)})`);
  }
  return failures;
}

async function waitForHealth(lf: Langfuse, timeoutMs = 300_000): Promise<{ version?: string }> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await getJson<{ version?: string }>(lf, 'health');
    } catch (err) {
      if (Date.now() > until) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Reads until Langfuse holds at least `count` observations and the number stops changing. */
export async function readBack(lf: Langfuse, count: number, timeoutMs = 180_000, pollMs = 2000): Promise<Observation[]> {
  const until = Date.now() + timeoutMs;
  let last = -1;
  for (;;) {
    const obs = await listObservations(lf);
    if (obs.length >= count && obs.length === last) return obs;
    if (Date.now() > until) {
      console.warn(`Langfuse holds ${obs.length} observations after ${timeoutMs / 1000} s; expected ${count}`);
      return obs;
    }
    last = obs.length;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** The whole Day 42 check against one Langfuse. `problems` is empty when every test has exactly its trace. */
export async function traceAll(
  lf: Langfuse,
  opts: { out?: string; readTimeoutMs?: number; pollMs?: number } = {},
): Promise<{ problems: string[]; expected: Expected[]; observations: Observation[] }> {
  const { out } = opts;
  const health = await waitForHealth(lf);
  console.log(`Langfuse ${health.version ?? '(version unknown)'} at ${lf.baseUrl}`);

  const { problems, checked } = await evaluate();
  const untraced = checked.flatMap((c) => c.rows.filter((r) => !r.response?.metadata?.traced).map((r) => `${c.suite} ${r.provider.label} ${r.vars.id}`));
  if (untraced.length) problems.push(`the provider could not send ${untraced.length} trace(s), first: ${untraced[0]}`);

  const expected = expectedTraces(checked);
  const now = Date.now();
  for (let i = 0; i < expected.length; i += 100) {
    await sendSpans(lf, expected.slice(i, i + 100).map((e) => evaluatorSpan(e, { pass: e.pass, expected: `label: ${e.label}`, reason: e.reason }, now)));
  }
  console.log(`sent ${expected.length} assertion results`);

  const observations = await readBack(lf, expected.length * 2, opts.readTimeoutMs, opts.pollMs);
  const diff = compareTraces(expected, observations);
  problems.push(...diff);
  console.log(`Langfuse holds ${observations.length} observations in ${new Set(observations.map((o) => o.traceId)).size} traces; ${diff.length ? `${diff.length} differences` : 'every test has exactly its trace'}`);
  problems.push(...(await selfTest(expected, observations, lf)));

  if (out) {
    fs.mkdirSync(path.join(out, 'prompts'), { recursive: true });
    for (const o of observations.filter((x) => x.type === 'GENERATION')) {
      fs.writeFileSync(path.join(out, 'prompts', `${sha256(text(o.input))}.txt`), text(o.input));
    }
    fs.writeFileSync(path.join(out, 'traces.json'), `${JSON.stringify(observations.map((o) => (o.type === 'GENERATION' ? { ...o, input: { sha256: sha256(text(o.input)) } } : o)), null, 2)}\n`);
    fs.writeFileSync(path.join(out, 'index.html'), renderTracesPage(expected, observations, {
      langfuseVersion: health.version ?? 'unknown',
      commit: process.env.GITHUB_SHA ?? 'local',
      problems,
    }));
    console.log(`wrote the traces report to ${out}`);
  }
  return { problems, expected, observations };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
  const lf = langfuseFromEnv();
  if (!lf) throw new Error('set LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY (see langfuse/README.md)');
  const { problems, expected } = await traceAll(lf, { out });
  if (problems.length) {
    console.error(`\n${problems.slice(0, 50).join('\n')}${problems.length > 50 ? `\n... and ${problems.length - 50} more` : ''}`);
    process.exit(1);
  }
  console.log(`\nall ${expected.length} AI tests have exactly one trace in Langfuse, holding the prompt, the reply and the result they had`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
