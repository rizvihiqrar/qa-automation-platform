// Records one red-team judge session into redteam/runs/<name>.json.
//
// node src/redteam-record.ts <replies.json> <name> <model id>
//
// Unlike Day 40's record.ts, which keeps parsed verdicts and refuses anything else,
// this keeps each reply exactly as written: a refusal, extra text or a broken format
// is a result here, not an error. It refuses only a missing, duplicate or unknown
// case, and stores the SHA-256 of every prompt the session answered.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRedItems, renderRed, RUBRIC } from './redteam.ts';
import { PKG, sha256 } from './render.ts';

export interface Reply {
  id: string;
  raw: string;
}

export interface RedRun {
  name: string;
  model: string;
  rubric: string;
  how: string;
  prompts: Record<string, string>;
  replies: Reply[];
}

export function validateReplies(raw: unknown, ids: string[]): Reply[] {
  if (!Array.isArray(raw)) throw new Error('replies must be a JSON array');
  const seen = new Set<string>();
  const replies = raw.map((r: unknown, i) => {
    const o = r as Record<string, unknown>;
    if (typeof o?.id !== 'string' || !ids.includes(o.id)) throw new Error(`reply ${i}: unknown id ${String(o?.id)}`);
    if (seen.has(o.id)) throw new Error(`${o.id}: answered twice`);
    seen.add(o.id);
    if (typeof o.raw !== 'string') throw new Error(`${o.id}: raw must be the reply text`);
    return { id: o.id, raw: o.raw };
  });
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`no reply for ${missing.join(', ')}`);
  return replies.sort((a, b) => a.id.localeCompare(b.id));
}

export function loadRedRuns(): RedRun[] {
  const dir = path.join(PKG, 'redteam', 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RedRun);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, name, model] = process.argv.slice(2);
  if (!file || !name || !model) throw new Error('usage: node src/redteam-record.ts <replies.json> <name> <model id>');
  const items = loadRedItems();
  const replies = validateReplies(JSON.parse(fs.readFileSync(file, 'utf8')), items.map((i) => i.id));
  const run: RedRun = {
    name,
    model,
    rubric: RUBRIC,
    how: 'A fresh Claude Code subagent that could read only the rendered prompts (one file per case), answered them in order and wrote each reply, unedited, to a file. No API key; nothing else in its context.',
    prompts: Object.fromEntries(items.map((item) => [item.id, sha256(renderRed(item))])),
    replies,
  };
  fs.mkdirSync(path.join(PKG, 'redteam', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(PKG, 'redteam', 'runs', `${name}.json`), JSON.stringify(run, null, 2) + '\n');
  console.log(`recorded ${replies.length} replies in redteam/runs/${name}.json`);
}
