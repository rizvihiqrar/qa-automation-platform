// Tracing for the replayed judge calls (Day 42): every promptfoo test case sends one
// trace to a self-hosted Langfuse over OpenTelemetry (OTLP/HTTP JSON).
//
// Trace IDs are derived, not random: the SHA-256 of the suite, the run, the case and
// the prompt's hash. The same test therefore has the same trace ID in every run and
// on every Langfuse instance, so a report can link a test to its trace without asking
// Langfuse first, and a trace sent for the wrong prompt can't carry the right ID.
//
// Each trace has two observations:
//   generation  the judge call: the prompt, the reply exactly as recorded, the model
//   evaluator   promptfoo's assertion on that reply: pass or fail, and why
//
// Shared by the promptfoo replay provider (which sends the generation) and
// src/traces.ts (which sends the evaluator and checks what Langfuse stored).
import crypto from 'node:crypto';

export type Suite = 'day40' | 'redteam';

const hex = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

/** 32 hex characters (16 bytes), the size of an OpenTelemetry trace ID. */
export function traceIdFor(suite: Suite, run: string, caseId: string, promptSha: string): string {
  if (!/^[0-9a-f]{64}$/.test(promptSha)) throw new Error(`${caseId}: not a SHA-256: ${promptSha}`);
  const id = hex(['llm-judge-check', suite, run, caseId, promptSha].join('\n')).slice(0, 32);
  // OpenTelemetry treats an all-zero ID as invalid; one chance in 2^128, but say so.
  if (/^0+$/.test(id)) throw new Error(`${caseId}: all-zero trace ID`);
  return id;
}

/** 16 hex characters (8 bytes), the size of an OpenTelemetry span ID. */
export function spanIdFor(traceId: string, kind: 'generation' | 'evaluator'): string {
  return hex(`${traceId}\n${kind}`).slice(0, 16);
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, string | string[]>;
}

type OtlpValue = { stringValue: string } | { arrayValue: { values: { stringValue: string }[] } };

const otlpValue = (v: string | string[]): OtlpValue =>
  Array.isArray(v) ? { arrayValue: { values: v.map((s) => ({ stringValue: s })) } } : { stringValue: v };

const nanos = (ms: number): string => (BigInt(Math.round(ms)) * 1_000_000n).toString();

/** An OTLP/HTTP JSON export request. IDs are hex in OTLP JSON, not base64. */
export function otlpPayload(spans: Span[]): object {
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'llm-judge-check' } }] },
      scopeSpans: [{
        scope: { name: 'llm-judge-check' },
        spans: spans.map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
          name: s.name,
          kind: 1, // SPAN_KIND_INTERNAL
          startTimeUnixNano: nanos(s.startMs),
          endTimeUnixNano: nanos(s.endMs),
          attributes: Object.entries(s.attributes).map(([key, v]) => ({ key, value: otlpValue(v) })),
          status: { code: 1 }, // STATUS_CODE_OK
        })),
      }],
    }],
  };
}

export interface Call {
  suite: Suite;
  run: string;
  caseId: string;
  model: string;
  prompt: string;
  promptSha: string;
  output: string;
}

// The run, not a CI job, is the Langfuse session: one judge session answered every
// case of a run in one context, which is what Day 41's J63 result turned on.
function common(c: Pick<Call, 'suite' | 'run' | 'caseId' | 'model' | 'promptSha'>, env: NodeJS.ProcessEnv): Record<string, string | string[]> {
  return {
    'langfuse.trace.name': `${c.suite} ${c.caseId}`,
    'langfuse.session.id': c.run,
    'langfuse.environment': env.GITHUB_ACTIONS ? 'ci' : 'local',
    'langfuse.release': env.GITHUB_SHA ?? 'local',
    'langfuse.trace.tags': [c.suite, c.model, 'replayed'],
    'langfuse.trace.metadata.suite': c.suite,
    'langfuse.trace.metadata.run': c.run,
    'langfuse.trace.metadata.case': c.caseId,
    'langfuse.trace.metadata.prompt_sha256': c.promptSha,
  };
}

/** The judge call, sent by the replay provider. Its timing is the replay's, not the model's. */
export function generationSpan(c: Call, startMs: number, endMs: number, env: NodeJS.ProcessEnv = process.env): Span {
  const traceId = traceIdFor(c.suite, c.run, c.caseId, c.promptSha);
  return {
    traceId,
    spanId: spanIdFor(traceId, 'generation'),
    name: 'judge',
    startMs,
    endMs,
    attributes: {
      ...common(c, env),
      'langfuse.observation.type': 'generation',
      'langfuse.observation.model.name': c.model,
      'langfuse.observation.input': c.prompt,
      'langfuse.observation.output': c.output,
      'langfuse.observation.metadata.replayed': 'true',
    },
  };
}

export interface Assertion {
  pass: boolean;
  expected: string;
  reason: string;
}

/** promptfoo's verdict on the reply, sent after the eval as a child of the generation. */
export function evaluatorSpan(c: Omit<Call, 'prompt' | 'output'>, a: Assertion, atMs: number, env: NodeJS.ProcessEnv = process.env): Span {
  const traceId = traceIdFor(c.suite, c.run, c.caseId, c.promptSha);
  return {
    traceId,
    spanId: spanIdFor(traceId, 'evaluator'),
    parentSpanId: spanIdFor(traceId, 'generation'),
    name: 'promptfoo assertion',
    startMs: atMs,
    endMs: atMs,
    attributes: {
      ...common(c, env),
      'langfuse.observation.type': 'evaluator',
      'langfuse.observation.level': a.pass ? 'DEFAULT' : 'WARNING',
      'langfuse.observation.input': a.expected,
      'langfuse.observation.output': JSON.stringify({ pass: a.pass, reason: a.reason }),
      'langfuse.observation.metadata.pass': String(a.pass),
    },
  };
}

export interface Langfuse {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

/** From LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY; null if any is unset. */
export function langfuseFromEnv(env: NodeJS.ProcessEnv = process.env): Langfuse | null {
  const { LANGFUSE_BASE_URL: baseUrl, LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;
  return baseUrl && publicKey && secretKey ? { baseUrl: baseUrl.replace(/\/+$/, ''), publicKey, secretKey } : null;
}

const auth = (lf: Langfuse): string => `Basic ${Buffer.from(`${lf.publicKey}:${lf.secretKey}`).toString('base64')}`;

/** Throws unless Langfuse accepted every span. */
export async function sendSpans(lf: Langfuse, spans: Span[]): Promise<void> {
  const res = await fetch(`${lf.baseUrl}/api/public/otel/v1/traces`, {
    method: 'POST',
    headers: {
      Authorization: auth(lf),
      'Content-Type': 'application/json',
      // Without it, spans sent straight over OTLP can take up to 10 minutes to show
      // up in the v2 read API.
      'x-langfuse-ingestion-version': '4',
    },
    body: JSON.stringify(otlpPayload(spans)),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Langfuse refused ${spans.length} span(s): HTTP ${res.status} ${text.slice(0, 300)}`);
  // OTLP reports spans it dropped in a 200 response.
  const rejected = Number((JSON.parse(text || '{}') as { partialSuccess?: { rejectedSpans?: string | number } }).partialSuccess?.rejectedSpans ?? 0);
  if (rejected) throw new Error(`Langfuse rejected ${rejected} of ${spans.length} span(s): ${text.slice(0, 300)}`);
}

/** GET a path under /api/public; throws on anything but 200. */
export async function getJson<T>(lf: Langfuse, pathAndQuery: string): Promise<T> {
  const res = await fetch(`${lf.baseUrl}/api/public/${pathAndQuery}`, { headers: { Authorization: auth(lf) } });
  if (!res.ok) throw new Error(`GET ${pathAndQuery}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** The fields this package reads from Langfuse's v2 observations API. */
export interface Observation {
  id: string;
  traceId: string;
  parentObservationId: string | null;
  type: string;
  name: string | null;
  sessionId: string | null;
  input: unknown;
  output: unknown;
  metadata: unknown;
  model?: string | null;
  startTime: string;
}

/** Every observation in the project (v2 is Langfuse's real-time read path). */
export async function listObservations(lf: Langfuse): Promise<Observation[]> {
  const all: Observation[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ fields: 'core,basic,io,metadata,model', limit: '1000' });
    if (cursor) q.set('cursor', cursor);
    const page = await getJson<{ data: Observation[]; meta: { cursor?: string | null } }>(lf, `v2/observations?${q}`);
    all.push(...page.data);
    cursor = page.meta.cursor ?? undefined;
  } while (cursor);
  return all;
}
