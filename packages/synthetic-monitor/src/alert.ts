// Opens and closes the `monitoring` issues for the latest run.
//
//   GH_TOKEN=… node src/alert.ts --data <folder> [--repo owner/name] [--run-url <url>]
//
// Reads <data>/summary.json (written by run.ts), asks GitHub which monitoring issues are open,
// and applies what planAlerts decides. `gh` is injected so the tests can use a fake.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LABEL, planAlerts, type Action, type OpenIssue } from './alerts.ts';
import type { SiteSummary } from './history.ts';

export type Gh = (args: string[]) => string;

export const realGh: Gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

export function applyAlerts(summaries: SiteSummary[], gh: Gh, repo: string, runUrl = ''): Action[] {
  const open = JSON.parse(gh(['issue', 'list', '-R', repo, '--label', LABEL, '--state', 'open', '--json', 'number,title', '--limit', '100'])) as OpenIssue[];
  const actions = planAlerts(summaries, open, runUrl);
  // The label has to exist before an issue can carry it; --force makes this safe to repeat.
  if (actions.some((a) => a.type === 'open')) gh(['label', 'create', LABEL, '-R', repo, '--description', 'Synthetic monitoring: a watched site is down', '--force']);
  for (const a of actions) {
    if (a.type === 'open') {
      gh(['issue', 'create', '-R', repo, '--title', a.title, '--body', a.body, '--label', LABEL]);
    } else {
      gh(['issue', 'close', String(a.number), '-R', repo, '--comment', a.comment]);
    }
  }
  return actions;
}

if (import.meta.main) {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
  };
  const dataDir = path.resolve(arg('--data', 'data'));
  const repo = arg('--repo', process.env.GITHUB_REPOSITORY ?? '');
  if (!repo) throw new Error('Give --repo owner/name, or set GITHUB_REPOSITORY');
  const { sites } = JSON.parse(fs.readFileSync(path.join(dataDir, 'summary.json'), 'utf8')) as { sites: SiteSummary[] };
  const actions = applyAlerts(sites, realGh, repo, arg('--run-url', ''));
  for (const a of actions) console.log(a.type === 'open' ? `opened: ${a.title}` : `closed #${a.number}: ${a.site} recovered`);
  if (!actions.length) console.log('no issue to open or close');
}
