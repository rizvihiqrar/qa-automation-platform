// Records one judge run from a Claude Code session into runs/<name>.json.
//
// node src/record.ts <answers.json> <name> <model id> <v1|v2> <1|2|all>
//
// The answers file is what the judge wrote: an array of {id, verdict, test, reason},
// one per case. Recording refuses a run with a missing, duplicate or unknown case or a
// verdict outside the rubric, and stores the SHA-256 of every rendered prompt, so a
// test can later prove the run answered exactly the prompts in this repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVerdict, type Verdict } from './stats.ts';
import { loadItems, PKG, render, RUBRICS, sha256, template, type Rubric } from './render.ts';
import { loadKey } from './review-sheet.ts';

export interface Answer {
  id: string;
  verdict: Verdict;
  test: string | null;
  reason: string;
}

export interface Run {
  name: string;
  model: string;
  rubric: Rubric;
  how: string;
  sessions: { cases: string }[];
  prompts: Record<string, string>; // id -> sha256 of the rendered prompt
  answers: Answer[];
}

export function validate(raw: unknown, ids: string[]): Answer[] {
  if (!Array.isArray(raw)) throw new Error('answers must be a JSON array');
  const seen = new Set<string>();
  const answers: Answer[] = raw.map((a: unknown, i) => {
    const o = a as Record<string, unknown>;
    if (typeof o?.id !== 'string' || !ids.includes(o.id)) throw new Error(`answer ${i}: unknown id ${String(o?.id)}`);
    if (seen.has(o.id)) throw new Error(`${o.id}: answered twice`);
    seen.add(o.id);
    if (!isVerdict(o.verdict)) throw new Error(`${o.id}: verdict ${JSON.stringify(o.verdict)} is not covered, partial or missing`);
    if (typeof o.reason !== 'string' || !o.reason.trim()) throw new Error(`${o.id}: no reason`);
    return { id: o.id, verdict: o.verdict, test: typeof o.test === 'string' ? o.test : null, reason: o.reason };
  });
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`no answer for ${missing.join(', ')}`);
  return answers.sort((a, b) => a.id.localeCompare(b.id));
}

export function loadRuns(): Run[] {
  const dir = path.join(PKG, 'runs');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Run);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, name, model, rubric = 'v1', casesArg = 'all'] = process.argv.slice(2);
  if (!file || !name || !model || !(rubric in RUBRICS) || !['1', '2', 'all'].includes(casesArg)) {
    throw new Error('usage: node src/record.ts <answers.json> <name> <model id> <v1|v2> <1|2|all>');
  }
  const key = loadKey();
  const items = loadItems().filter((item) => casesArg === 'all' || key[item.id]?.round === Number(casesArg));
  const tpl = template(rubric as Rubric);
  const out = path.join(PKG, 'runs', `${name}.json`);
  // Rubric v1's round 2 was answered in a second session by a fresh subagent of the
  // same model, so it is merged into the same run file; `sessions` says which cases
  // each session answered.
  const previous = casesArg === '2' ? (JSON.parse(fs.readFileSync(out, 'utf8')) as Run) : null;
  if (previous && (previous.model !== model || previous.rubric !== rubric)) throw new Error(`${name} was recorded with ${previous.model} and rubric ${previous.rubric}`);
  const answers = validate(JSON.parse(fs.readFileSync(file, 'utf8')), items.map((i) => i.id));
  const run: Run = {
    name,
    model,
    rubric: rubric as Rubric,
    how: 'Each session: a fresh Claude Code subagent that could read only the rendered prompts (one file per case), answered them in order and wrote its answers to a file. No API key; nothing else in its context.',
    sessions: [...(previous?.sessions ?? []), { cases: `${items[0]?.id}–${items.at(-1)?.id}` }],
    prompts: { ...previous?.prompts, ...Object.fromEntries(items.map((item) => [item.id, sha256(render(item, tpl))])) },
    answers: [...(previous?.answers ?? []), ...answers].sort((a, b) => a.id.localeCompare(b.id)),
  };
  fs.mkdirSync(path.join(PKG, 'runs'), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(run, null, 2) + '\n');
  console.log(`recorded ${answers.length} answers (rubric ${rubric}, cases ${casesArg}) in runs/${name}.json (${run.answers.length} in all)`);
}
