// A promptfoo provider that replays a recorded judge run instead of calling a model,
// so the eval runs in CI with no API key and gives the same answer every time.
//
// It answers only if the prompt promptfoo rendered is byte-for-byte the prompt the
// judge answered (same SHA-256 as recorded); anything else is an error, not a guess.
//
// config.run: the run's name. config.dir: runs/ (Day 40, parsed answers) by default,
// or redteam/runs (Day 41, each reply kept exactly as written, returned unchanged).
//
// Day 42: every answer carries its trace ID in metadata.traceId (derived from the
// suite, run, case and prompt hash; src/trace.ts). With LANGFUSE_BASE_URL,
// LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY set, it also sends the call to Langfuse
// as that trace. A tracing failure doesn't fail the call, as in production: it is
// reported as metadata.traced = false, and src/traces.ts checks what Langfuse stored.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generationSpan, langfuseFromEnv, sendSpans, traceIdFor } from '../src/trace.ts';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');

export default class ReplayProvider {
  constructor(options) {
    this.run = options.config.run;
    this.label = options.label ?? this.run;
    this.suite = options.config.dir === 'redteam/runs' ? 'redteam' : 'day40';
    this.recorded = JSON.parse(fs.readFileSync(path.join(PKG, options.config.dir ?? 'runs', `${this.run}.json`), 'utf8'));
    this.langfuse = langfuseFromEnv();
  }

  id() {
    return `replay:${this.run}`;
  }

  async callApi(prompt, context) {
    const start = Date.now();
    const id = context?.vars?.id;
    const reply = this.recorded.replies?.find((r) => r.id === id);
    const answer = this.recorded.answers?.find((a) => a.id === id);
    if (!reply && !answer) return { error: `${this.run} has no answer for ${id}` };
    if (sha256(prompt) !== this.recorded.prompts[id]) {
      return { error: `${id}: the rendered prompt differs from the one ${this.run} answered` };
    }
    let output;
    if (reply) output = reply.raw;
    else {
      const { verdict, test, reason } = answer;
      output = JSON.stringify({ verdict, test, reason });
    }

    const call = { suite: this.suite, run: this.run, caseId: id, model: this.recorded.model, prompt, promptSha: this.recorded.prompts[id], output };
    const metadata = { traceId: traceIdFor(call.suite, call.run, call.caseId, call.promptSha), traced: false };
    if (this.langfuse) {
      try {
        await sendSpans(this.langfuse, [generationSpan(call, start, Date.now())]);
        metadata.traced = true;
      } catch (err) {
        console.warn(`${this.run} ${id}: trace not sent: ${err.message}`);
      }
    }
    return { output, metadata };
  }
}
