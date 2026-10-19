// Day 42: trace IDs, the OTLP payload, sending to Langfuse, and the replay provider's
// tracing. Uses a fake Langfuse (test/fake-langfuse.ts); CI checks the real one.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
// @ts-expect-error plain JavaScript module with no type declarations
import ReplayProvider from '../promptfoo/replay-provider.mjs';
import { loadRuns } from '../src/record.ts';
import { loadRedRuns } from '../src/redteam-record.ts';
import { loadItems, render, sha256, template } from '../src/render.ts';
import {
  evaluatorSpan, generationSpan, langfuseFromEnv, listObservations, otlpPayload, sendSpans, spanIdFor, traceIdFor,
} from '../src/trace.ts';
import { startFake, type Fake } from './fake-langfuse.ts';

const SHA = sha256('a prompt');

test('a trace ID is 32 hex characters and the same every time', () => {
  const id = traceIdFor('day40', 'haiku-1', 'J01', SHA);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(traceIdFor('day40', 'haiku-1', 'J01', SHA), id);
  assert.match(spanIdFor(id, 'generation'), /^[0-9a-f]{16}$/);
  assert.notEqual(spanIdFor(id, 'generation'), spanIdFor(id, 'evaluator'));
});

test('a trace ID changes with the suite, the run, the case and the prompt', () => {
  const id = traceIdFor('day40', 'haiku-1', 'J01', SHA);
  assert.notEqual(traceIdFor('redteam', 'haiku-1', 'J01', SHA), id);
  assert.notEqual(traceIdFor('day40', 'haiku-2', 'J01', SHA), id);
  assert.notEqual(traceIdFor('day40', 'haiku-1', 'J02', SHA), id);
  assert.notEqual(traceIdFor('day40', 'haiku-1', 'J01', sha256('another prompt')), id);
});

test('a trace ID needs a real SHA-256 for the prompt', () => {
  assert.throws(() => traceIdFor('day40', 'haiku-1', 'J01', 'abc'), /not a SHA-256/);
});

test('all 900 recorded answers get different trace IDs', () => {
  const ids = [
    ...loadRuns().flatMap((r) => r.answers.map((a) => traceIdFor('day40', r.name, a.id, r.prompts[a.id]!))),
    ...loadRedRuns().flatMap((r) => r.replies.map((a) => traceIdFor('redteam', r.name, a.id, r.prompts[a.id]!))),
  ];
  assert.equal(ids.length, 900);
  assert.equal(new Set(ids).size, 900);
});

const call = { suite: 'day40' as const, run: 'haiku-1', caseId: 'J01', model: 'claude-haiku-5-5', prompt: 'a prompt', promptSha: SHA, output: '{"verdict":"covered"}' };

test('the generation span carries the prompt, the reply, the model and the run as session', () => {
  const s = generationSpan(call, 1000, 1005, {});
  assert.equal(s.traceId, traceIdFor('day40', 'haiku-1', 'J01', SHA));
  assert.equal(s.spanId, spanIdFor(s.traceId, 'generation'));
  assert.equal(s.parentSpanId, undefined);
  assert.equal(s.attributes['langfuse.observation.type'], 'generation');
  assert.equal(s.attributes['langfuse.observation.input'], 'a prompt');
  assert.equal(s.attributes['langfuse.observation.output'], '{"verdict":"covered"}');
  assert.equal(s.attributes['langfuse.observation.model.name'], 'claude-haiku-5-5');
  assert.equal(s.attributes['langfuse.session.id'], 'haiku-1');
  assert.equal(s.attributes['langfuse.environment'], 'local');
  assert.equal(generationSpan(call, 0, 0, { GITHUB_ACTIONS: 'true', GITHUB_SHA: 'abc' }).attributes['langfuse.release'], 'abc');
});

test('the evaluator span is a child of the generation and says pass or fail', () => {
  const s = evaluatorSpan(call, { pass: false, expected: 'label: covered', reason: 'nope' }, 2000, {});
  assert.equal(s.traceId, traceIdFor('day40', 'haiku-1', 'J01', SHA));
  assert.equal(s.parentSpanId, spanIdFor(s.traceId, 'generation'));
  assert.equal(s.attributes['langfuse.observation.type'], 'evaluator');
  assert.deepEqual(JSON.parse(s.attributes['langfuse.observation.output'] as string), { pass: false, reason: 'nope' });
  assert.equal(s.attributes['langfuse.observation.level'], 'WARNING');
});

test('the OTLP payload uses hex IDs, nanosecond strings and typed attribute values', () => {
  const p = otlpPayload([evaluatorSpan(call, { pass: true, expected: 'x', reason: 'ok' }, 1700000000123, {})]) as {
    resourceSpans: { scopeSpans: { spans: { traceId: string; parentSpanId: string; startTimeUnixNano: string; attributes: { key: string; value: unknown }[] }[] }[] }[];
  };
  const span = p.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
  assert.match(span.traceId, /^[0-9a-f]{32}$/);
  assert.match(span.parentSpanId, /^[0-9a-f]{16}$/);
  assert.equal(span.startTimeUnixNano, '1700000000123000000');
  assert.deepEqual(span.attributes.find((a) => a.key === 'langfuse.trace.tags')!.value, {
    arrayValue: { values: [{ stringValue: 'day40' }, { stringValue: 'claude-haiku-5-5' }, { stringValue: 'replayed' }] },
  });
});

test('Langfuse settings come from all three variables or none', () => {
  assert.equal(langfuseFromEnv({ LANGFUSE_BASE_URL: 'http://x', LANGFUSE_PUBLIC_KEY: 'pk' }), null);
  assert.deepEqual(langfuseFromEnv({ LANGFUSE_BASE_URL: 'http://x/', LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' }), { baseUrl: 'http://x', publicKey: 'pk', secretKey: 'sk' });
});

let fake: Fake;
before(async () => { fake = await startFake(); });
after(async () => { await fake.close(); });

test('sending asks for real-time ingestion and authenticates with the project keys', async () => {
  fake.observations.clear();
  await sendSpans(fake.lf, [generationSpan(call, 0, 1, {})]);
  const req = fake.requests.findLast((r) => r.path === '/api/public/otel/v1/traces')!;
  assert.equal(req.headers['x-langfuse-ingestion-version'], '4');
  assert.equal(req.headers['content-type'], 'application/json');
  assert.equal((await listObservations(fake.lf)).length, 1);
});

test('sending fails loudly on a refused request', async () => {
  await assert.rejects(sendSpans({ ...fake.lf, secretKey: 'wrong' }, [generationSpan(call, 0, 1, {})]), /HTTP 401/);
  fake.failNext(1, 503);
  await assert.rejects(sendSpans(fake.lf, [generationSpan(call, 0, 1, {})]), /HTTP 503/);
});

test('reading pages through every observation', async () => {
  const small = await startFake(7);
  const spans = Array.from({ length: 20 }, (_, i) => generationSpan({ ...call, caseId: `J${i}` }, 0, 1, {}));
  await sendSpans(small.lf, spans);
  const got = await listObservations(small.lf);
  await small.close();
  assert.equal(got.length, 20);
  assert.equal(new Set(got.map((o) => o.traceId)).size, 20);
});

const item = loadItems()[0]!;
const prompt = render(item, template('v2'));

test('the replay provider returns the derived trace ID, traced or not', async () => {
  const res = await new ReplayProvider({ config: { run: 'haiku-v2-1' } }).callApi(prompt, { vars: { id: item.id } });
  const want = traceIdFor('day40', 'haiku-v2-1', item.id, loadRuns().find((r) => r.name === 'haiku-v2-1')!.prompts[item.id]!);
  assert.deepEqual(res.metadata, { traceId: want, traced: false });
});

function withLangfuse<T>(lf: Fake['lf'], fn: () => T): T {
  const saved = { ...process.env };
  Object.assign(process.env, { LANGFUSE_BASE_URL: lf.baseUrl, LANGFUSE_PUBLIC_KEY: lf.publicKey, LANGFUSE_SECRET_KEY: lf.secretKey });
  try { return fn(); } finally { process.env = saved; }
}

test('with Langfuse set, the replay provider sends the call as its trace', async () => {
  fake.observations.clear();
  const provider = withLangfuse(fake.lf, () => new ReplayProvider({ config: { run: 'haiku-v2-1' } }));
  const res = await provider.callApi(prompt, { vars: { id: item.id } });
  assert.equal(res.metadata.traced, true);
  const [gen] = await listObservations(fake.lf);
  assert.equal(gen!.traceId, res.metadata.traceId);
  assert.equal(gen!.input, prompt);
  assert.equal(gen!.output, res.output);
  assert.equal(gen!.model, 'claude-haiku-5-5');
});

test('a red-team reply is traced exactly as written', async () => {
  fake.observations.clear();
  const red = loadRedRuns().find((r) => r.name === 'sonnet-1')!;
  const provider = withLangfuse(fake.lf, () => new ReplayProvider({ config: { run: 'sonnet-1', dir: 'redteam/runs' } }));
  const { renderRed, loadRedItems } = await import('../src/redteam.ts');
  const ri = loadRedItems()[0]!;
  const res = await provider.callApi(renderRed(ri), { vars: { id: ri.id } });
  const [gen] = await listObservations(fake.lf);
  assert.equal(gen!.output, red.replies.find((r) => r.id === ri.id)!.raw);
  assert.equal(gen!.traceId, traceIdFor('redteam', 'sonnet-1', ri.id, red.prompts[ri.id]!));
  assert.equal(res.metadata.traced, true);
});

test('a tracing failure does not fail the call, but says it was not traced', async () => {
  const provider = withLangfuse(fake.lf, () => new ReplayProvider({ config: { run: 'haiku-v2-1' } }));
  fake.failNext(1, 500);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const res = await provider.callApi(prompt, { vars: { id: item.id } });
    assert.equal(res.error, undefined);
    assert.ok(res.output);
    assert.equal(res.metadata.traced, false);
  } finally { console.warn = warn; }
});
