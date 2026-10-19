// Day 42: the whole tracing check (both promptfoo evals, assertions sent, everything
// read back and compared) against a fake Langfuse, then each kind of mismatch the
// comparison must catch, applied to the real 1,800 observations that run produced.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { sha256 } from '../src/render.ts';
import { spanIdFor, traceIdFor, type Observation } from '../src/trace.ts';
import { compareTraces, traceAll, type Expected } from '../src/traces.ts';
import { startFake, type Fake } from './fake-langfuse.ts';

let fake: Fake;
let out: string;
let result: { problems: string[]; expected: Expected[]; observations: Observation[] };
const saved = { ...process.env };

before(async () => {
  fake = await startFake();
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'traces-'));
  // The provider runs inside promptfoo's process, which inherits these.
  Object.assign(process.env, { LANGFUSE_BASE_URL: fake.lf.baseUrl, LANGFUSE_PUBLIC_KEY: fake.lf.publicKey, LANGFUSE_SECRET_KEY: fake.lf.secretKey });
  const log = console.log;
  console.log = () => {};
  try { result = await traceAll(fake.lf, { out, readTimeoutMs: 10_000, pollMs: 50 }); } finally { console.log = log; }
});

after(async () => {
  process.env = saved;
  await fake.close();
  fs.rmSync(out, { recursive: true, force: true });
});

test('every one of the 900 AI tests has exactly its trace', () => {
  assert.deepEqual(result.problems, []);
  assert.equal(result.expected.length, 900);
  assert.equal(result.observations.length, 1800);
  assert.equal(new Set(result.observations.map((o) => o.traceId)).size, 900);
});

test('the report page has one row per test, anchored by its trace ID', () => {
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const anchors = [...html.matchAll(/<tr id="([0-9a-f]{32})">/g)].map((m) => m[1]);
  assert.equal(anchors.length, 900);
  assert.deepEqual(new Set(anchors), new Set(result.expected.map((e) => e.traceId)));
  // Failed promptfoo tests are shown as failures; the trace column must match on every row.
  assert.equal([...html.matchAll(/<span class="ok">matches<\/span>/g)].length, 900);
  assert.doesNotMatch(html, /no generation|no result traced|<h2>Problems/);
});

test('the report keeps each prompt once, under its hash', () => {
  const files = fs.readdirSync(path.join(out, 'prompts'));
  const shas = new Set(result.expected.map((e) => e.promptSha));
  assert.equal(files.length, shas.size);
  for (const f of files) assert.equal(sha256(fs.readFileSync(path.join(out, 'prompts', f), 'utf8')), f.replace('.txt', ''));
  const traces = JSON.parse(fs.readFileSync(path.join(out, 'traces.json'), 'utf8')) as Observation[];
  assert.equal(traces.length, 1800);
});

// Each mismatch below is applied to a copy of what the fake Langfuse returned.
const obs = () => result.observations.map((o) => ({ ...o }));
const gen = (list: Observation[], e: Expected) => list.find((o) => o.id === spanIdFor(e.traceId, 'generation'))!;
const ev = (list: Observation[], e: Expected) => list.find((o) => o.id === spanIdFor(e.traceId, 'evaluator'))!;
const caught = (list: Observation[], pattern: RegExp) => {
  const problems = compareTraces(result.expected, list);
  assert.ok(problems.some((p) => pattern.test(p)), `not caught; problems: ${problems.slice(0, 3).join(' | ') || '(none)'}`);
};

test('caught: a test whose trace never arrived', () => {
  const e = result.expected[5]!;
  caught(obs().filter((o) => o.traceId !== e.traceId), new RegExp(`${e.caseId} .*no trace in Langfuse`));
});

test('caught: a trace with its assertion result missing', () => {
  const e = result.expected[6]!;
  caught(obs().filter((o) => o.id !== spanIdFor(e.traceId, 'evaluator')), /1 generation\(s\), 0 evaluator\(s\)/);
});

test('caught: a judge call traced twice', () => {
  const list = obs();
  list.push({ ...gen(list, result.expected[7]!), id: 'ffffffffffffffff' });
  caught(list, /2 generation\(s\)/);
});

test('caught: a reply changed on the way to Langfuse', () => {
  const list = obs();
  const g = gen(list, result.expected[8]!);
  g.output = JSON.stringify(JSON.parse(String(g.output)), null, 1);
  caught(list, /traced reply differs/);
});

test('caught: a trace that holds another prompt', () => {
  const list = obs();
  gen(list, result.expected[9]!).input = gen(list, result.expected[100]!).input;
  caught(list, /traced prompt is not the one the judge answered/);
});

test('caught: the wrong model, the wrong session', () => {
  const list = obs();
  gen(list, result.expected.find((e) => e.model === 'claude-haiku-5-5')!).model = 'claude-sonnet-5-5';
  gen(list, result.expected[11]!).sessionId = 'haiku-9';
  caught(list, /model claude-sonnet-5-5, expected claude-haiku-5-5/);
  caught(list, /session haiku-9/);
});

test('caught: a result that disagrees with promptfoo', () => {
  const list = obs();
  const e = result.expected.find((x) => !x.pass)!;
  ev(list, e).output = JSON.stringify({ pass: true, reason: 'ok' });
  caught(list, /traced result true, promptfoo false/);
});

test('caught: an assertion result attached to nothing', () => {
  const list = obs();
  ev(list, result.expected[12]!).parentObservationId = null;
  caught(list, /evaluator's parent is null/);
});

test('caught: a trace no test explains', () => {
  const list = obs();
  const stray = traceIdFor('day40', 'haiku-1', 'J99', result.expected[0]!.promptSha);
  list.push({ ...gen(list, result.expected[0]!), traceId: stray, id: spanIdFor(stray, 'generation') });
  caught(list, new RegExp(`trace ${stray} .*no test explains it`));
});

test('caught: two tests given the same trace ID', () => {
  const twin = result.expected.map((e, i) => (i === 1 ? { ...e, traceId: result.expected[0]!.traceId } : e));
  assert.ok(compareTraces(twin, result.observations).some((p) => /share a trace ID/.test(p)));
});
