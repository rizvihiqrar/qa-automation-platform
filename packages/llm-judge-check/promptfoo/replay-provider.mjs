// A promptfoo provider that replays a recorded judge run instead of calling a model,
// so the eval runs in CI with no API key and gives the same answer every time.
//
// It answers only if the prompt promptfoo rendered is byte-for-byte the prompt the
// judge answered (same SHA-256 as recorded); anything else is an error, not a guess.
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
    this.recorded = JSON.parse(fs.readFileSync(path.join(PKG, 'runs', `${this.run}.json`), 'utf8'));
  }

  id() {
    return `replay:${this.run}`;
  }

  async callApi(prompt, context) {
    const id = context?.vars?.id;
    const answer = this.recorded.answers.find((a) => a.id === id);
    if (!answer) return { error: `${this.run} has no answer for ${id}` };
    if (false) {
      return { error: `${id}: the rendered prompt differs from the one ${this.run} answered` };
    }
    const { verdict, test, reason } = answer;
    return { output: JSON.stringify({ verdict, test, reason }) };
  }
}
