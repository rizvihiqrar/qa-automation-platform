// npm run cost                       rewrites docs/ci-cost.md from the saved snapshot (data/cost-snapshot.json)
// npm run cost -- --refresh [--days 14] [--repo owner/name]
//                                    reads the real runs from GitHub, saves the snapshot, then rewrites the page
// Exits 1 if a job in the snapshot has no kind in data/job-tags.json. A tag for a job that did not run is a note, not an error.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from './build.ts';
import { checkTags, costMarkdown, staleTags, type Snapshot } from './cost.ts';
import { fetchCostSnapshot } from './live-cost.ts';

const file = (name: string) => path.join(packageRoot, name);

// Only these flags exist, and the ones that take a value must have one: a typo such as --refesh
// would otherwise skip the refresh and print the old numbers with a success exit.
const FLAGS = { '--refresh': false, '--days': true, '--repo': true } as const;
const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const flag = args[i]!;
  if (!(flag in FLAGS)) {
    console.error(`unknown option "${flag}": use ${Object.keys(FLAGS).join(', ')}`);
    process.exit(1);
  }
  if (FLAGS[flag as keyof typeof FLAGS]) {
    const value = args[++i];
    if (!value || value.startsWith('--')) {
      console.error(`${flag} needs a value`);
      process.exit(1);
    }
    values.set(flag, value);
  } else {
    values.set(flag, 'yes');
  }
}

function token(): string | undefined {
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

if (values.has('--refresh')) {
  const days = Number(values.get('--days') ?? '14');
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    console.error('--days must be a whole number from 1 to 60');
    process.exit(1);
  }
  const repo = values.get('--repo') ?? process.env.GITHUB_REPOSITORY ?? 'rizvihiqrar/qa-automation-platform';
  const auth = token();
  if (!auth) {
    console.error('--refresh makes one request per run (about 150 for 14 days); without a token GitHub allows 60 an hour. Set GITHUB_TOKEN or run `gh auth login`. The saved snapshot was not changed.');
    process.exit(1);
  }
  const snapshot = await fetchCostSnapshot(days, new Date(), { repo, token: auth }).catch((error: Error) => {
    console.error(`${error.message}. The saved snapshot was not changed.`);
    process.exit(1);
  });
  fs.writeFileSync(file('data/cost-snapshot.json'), `${JSON.stringify(snapshot)}\n`);
  console.log(`Saved data/cost-snapshot.json (${snapshot.runs.length} runs)`);
}

const snapshot = JSON.parse(fs.readFileSync(file('data/cost-snapshot.json'), 'utf8')) as Snapshot;
const tags = JSON.parse(fs.readFileSync(file('data/job-tags.json'), 'utf8')) as Record<string, string>;
const jobNames = snapshot.runs.flatMap((r) => r.jobs.map((j) => j.name));
const problems = checkTags(tags, jobNames);
for (const stale of staleTags(tags, jobNames)) console.warn(`note: "${stale}" is tagged but did not run in these runs`);
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
fs.writeFileSync(file('docs/ci-cost.md'), costMarkdown(snapshot, tags));
console.log(`Wrote docs/ci-cost.md (${snapshot.runs.length} runs)`);
