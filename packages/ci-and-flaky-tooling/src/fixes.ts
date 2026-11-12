// The fix-the-pipeline log (data/fixes.json): each pipeline failure that was fixed, with the
// cause, the fix, how long the fix took and the check that stops it coming back.
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot, repoRoot } from './build.ts';

export interface Fix {
  id: string;
  date: string; // YYYY-MM-DD
  symptom: string;
  cause: string;
  fix: string;
  pr: number;
  /** Minutes from the pull request opening to its merge. Not the length of the red: that is in the CI health report. */
  prMinutes: number;
  /** Repo path of the test or rule that fails if the problem comes back. */
  check: string;
  checkDoes: string;
}

export function readFixes(): Fix[] {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'data', 'fixes.json'), 'utf8')) as Fix[];
}

const FIELDS = ['symptom', 'cause', 'fix', 'checkDoes'] as const;

/** One message per entry that is incomplete, out of order or names a check that does not exist. */
export function checkFixes(fixes: Fix[], exists: (file: string) => boolean = (f) => fs.existsSync(path.join(repoRoot, f))): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  fixes.forEach((f, i) => {
    for (const field of FIELDS) if (!f[field]?.trim()) problems.push(`${f.id}: ${field} is empty`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) problems.push(`${f.id}: date must look like 2026-11-11`);
    if (!Number.isInteger(f.pr) || f.pr <= 0) problems.push(`${f.id}: pr must be a pull request number`);
    if (seen.has(f.pr)) problems.push(`${f.id}: pull request #${f.pr} is listed twice`);
    seen.add(f.pr);
    if (!Number.isFinite(f.prMinutes) || f.prMinutes < 0) problems.push(`${f.id}: prMinutes must be 0 or more`);
    if (!f.check || !exists(f.check)) problems.push(`${f.id}: the check ${f.check || '(none)'} does not exist`);
    const prev = fixes[i - 1];
    if (prev && prev.date < f.date) problems.push(`${f.id}: newest first, but it is dated after ${prev.id}`);
  });
  return problems;
}

const duration = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`);

export function fixesMarkdown(fixes: Fix[], repo = 'rizvihiqrar/qa-automation-platform'): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const row = (f: Fix) =>
    `| ${f.date} | ${cell(f.symptom)} | ${cell(f.cause)} | ${cell(f.fix)} | [#${f.pr}](https://github.com/${repo}/pull/${f.pr}) | ${duration(f.prMinutes)} | \`${f.check}\`: ${cell(f.checkDoes)} |`;
  return [
    '# Fix-the-Pipeline Log',
    '',
    `${fixes.length} pipeline failures fixed, newest first, from \`data/fixes.json\`. Each one names the cause, the pull request and the check that fails if it comes back. "Fix time" is the pull request open to merge, not the length of the red.`,
    '',
    '| Date | What failed | Cause | Fix | Pull request | Fix time | Check that stops it coming back |',
    '|---|---|---|---|---|---|---|',
    ...fixes.map(row),
    '',
  ].join('\n');
}
