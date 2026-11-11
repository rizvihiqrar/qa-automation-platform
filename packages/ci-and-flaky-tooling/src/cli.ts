// npm run report -- --month 2026-10 [--repo owner/name] [--out reports/2026-10.md]
// Reads the real CI runs and escaped-bug issues, prints the quality report (or writes it).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildReport, packageRoot } from './build.ts';
import { fetchEscapedIssues, fetchMainRuns } from './live.ts';

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? undefined : process.argv[at + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function token(): string | undefined {
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined; // public data still works without a token, within the lower rate limit
  }
}

const now = new Date().toISOString();
const month = arg('month', now.slice(0, 7));
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
  console.error(`--month must look like 2026-10, not "${month}"`);
  process.exit(1);
}
const repo = arg('repo', process.env.GITHUB_REPOSITORY ?? 'rizvihiqrar/qa-automation-platform');
const options = { repo, token: token() };

const [runs, issues] = await Promise.all([fetchMainRuns(month, options), fetchEscapedIssues(options)]);
const markdown = buildReport({ month, repo, now, runs, issues });
const out = arg('out', '');
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(packageRoot, out)), { recursive: true });
  fs.writeFileSync(path.resolve(packageRoot, out), markdown);
  console.log(`Wrote ${out} (${runs.length} runs, ${issues.length} escaped-bug issues)`);
} else {
  process.stdout.write(markdown);
}
