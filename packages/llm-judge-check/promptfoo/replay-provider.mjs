// A promptfoo provider that replays a recorded judge run instead of calling a model,
// so the eval runs in CI with no API key and gives the same answer every time.
//
// It answers only if the prompt promptfoo rendered is byte-for-byte the prompt the
// judge answered (same SHA-256 as recorded); anything else is an error, not a guess.
//
// config.run: the run's name. config.dir: runs/ (Day 40, parsed answers) by default,
// or redteam/runs (Day 41, each reply kept exactly as written, returned unchanged).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');

export default class ReplayProvider {
  constructor(options) {
    this.run = options.config.run;
    this.label = options.label ?? this.run;
    this.recorded = JSON.parse(fs.readFileSync(path.join(PKG, options.config.dir ?? 'runs', `${this.run}.json`), 'utf8'));
  }

  id() {
    return `replay:${this.run}`;
  }

  async callApi(prompt, context) {
    const id = context?.vars?.id;
    const reply = this.recorded.replies?.find((r) => r.id === id);
    const answer = this.recorded.answers?.find((a) => a.id === id);
    if (!reply && !answer) return { error: `${this.run} has no answer for ${id}` };
    if (sha256(prompt) !== this.recorded.prompts[id]) {
      return { error: `${id}: the rendered prompt differs from the one ${this.run} answered` };
    }
    if (reply) return { output: reply.raw };
    const { verdict, test, reason } = answer;
    return { output: JSON.stringify({ verdict, test, reason }) };
  }
}
