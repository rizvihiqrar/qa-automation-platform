// The quality gates as one policy file (data/gates.json): every gate, its threshold and its owner,
// and where in the repo it is enforced. checkGates reads those files and reports any gate whose
// text has changed or moved, so the file cannot say one thing while CI does another.
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot, repoRoot } from './build.ts';

export interface GateCheck {
  /** Plain text (not a pattern) that must appear in the file. */
  pattern: string;
  /** How many times it must appear: fewer means the gate is gone, more means a new one is not listed. */
  count: number;
}

export interface Gate {
  id: string;
  gate: string;
  threshold: string;
  /** True: a failure turns a CI job red. False: it is only reported. */
  blocks: boolean;
  owner: string;
  enforcedIn: string;
  checks: GateCheck[];
}

export function readGates(): Gate[] {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'data', 'gates.json'), 'utf8')) as Gate[];
}

const occurrences = (text: string, part: string) => (part ? text.split(part).length - 1 : 0);

/** One message per gate that no longer matches the file that enforces it. */
export function checkGates(gates: Gate[], read: (file: string) => string | null = (f) => {
  const full = path.join(repoRoot, f);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const g of gates) {
    if (ids.has(g.id)) problems.push(`${g.id}: listed twice`);
    ids.add(g.id);
    if (!g.owner.trim() || !g.threshold.trim() || g.checks.length === 0) problems.push(`${g.id}: needs an owner, a threshold and at least one check`);
    const text = read(g.enforcedIn);
    if (text === null) {
      problems.push(`${g.id}: ${g.enforcedIn} does not exist`);
      continue;
    }
    for (const { pattern, count } of g.checks) {
      const found = occurrences(text, pattern);
      if (found !== count) problems.push(`${g.id}: "${pattern}" appears ${found} times in ${g.enforcedIn}, the policy says ${count}`);
    }
  }
  return problems;
}

export function gatesMarkdown(gates: Gate[]): string {
  const row = (g: Gate) => `| ${g.gate} | ${g.threshold} | ${g.blocks ? 'Blocks the job' : 'Reported only'} | ${g.owner} | \`${g.enforcedIn}\` |`;
  return [
    '# Quality Gates',
    '',
    'Every gate in one list, from `data/gates.json`. A test reads each file named below and fails when the text that sets the threshold has changed, moved or been copied somewhere the list does not know about.',
    '',
    '| Gate | Threshold | Effect | Owner | Set in |',
    '|---|---|---|---|---|',
    ...gates.map(row),
    '',
  ].join('\n');
}
