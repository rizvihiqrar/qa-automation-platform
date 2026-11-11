// Puts the pieces together: runs and issues in, one Markdown report out. No network and no
// clock here (both are passed in), so the same input always gives the same report.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flakyRate, inMonth, runTime, timeToFixRedMain, type Run } from './metrics.ts';
import { loadSeed, parseIssue, summarize, type Entry, type IssueLike, type Problem, type SeedEntry } from './escaped.ts';
import { toMarkdown } from './report.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(here, '..');
export const repoRoot = path.resolve(packageRoot, '..', '..');

export function readSeed(): SeedEntry[] {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'data', 'escaped-bugs.json'), 'utf8')) as SeedEntry[];
}

export interface BuildInput {
  month: string;
  repo: string;
  /** ISO time: the end of a still-open red, and the report date. */
  now: string;
  runs: Run[];
  issues: IssueLike[];
  root?: string;
}

export function buildReport({ month, repo, now, runs, issues, root = repoRoot }: BuildInput): string {
  const monthRuns = inMonth(runs, month);
  const entries: Entry[] = loadSeed(root, readSeed());
  const problems: Problem[] = [];
  for (const issue of issues) {
    const parsed = parseIssue(issue);
    if ('entry' in parsed) entries.push(parsed.entry);
    else problems.push(parsed.problem);
  }
  return toMarkdown({
    month,
    repo,
    generated: now.slice(0, 10),
    flaky: flakyRate(monthRuns),
    red: timeToFixRedMain(runs, now, month),
    time: runTime(monthRuns),
    escaped: summarize(entries, month),
    problems,
  });
}
