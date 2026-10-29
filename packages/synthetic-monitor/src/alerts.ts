// Decides which GitHub issues to open and close. Pure: alert.ts does the calling.
import { DOWN_AFTER, type SiteSummary } from './history.ts';

export const LABEL = 'monitoring';

export interface OpenIssue {
  number: number;
  title: string;
}

export type Action =
  | { type: 'open'; site: string; title: string; body: string }
  | { type: 'close'; site: string; number: number; comment: string };

export const issueTitle = (site: string) => `Monitor: ${site} is down`;

/**
 * A site that is down (2 failed runs in a row) gets one open issue. The issue closes when the
 * site passes again. A single failed run changes nothing, and neither does a slow load.
 */
export function planAlerts(summaries: SiteSummary[], openIssues: OpenIssue[], runUrl = ''): Action[] {
  const actions: Action[] = [];
  for (const s of summaries) {
    const mine = openIssues.filter((i) => i.title === issueTitle(s.site));
    if (s.status === 'down' && !mine.length) {
      actions.push({
        type: 'open',
        site: s.site,
        title: issueTitle(s.site),
        body: [
          `${s.site} failed its last ${DOWN_AFTER} runs in a row (each run retries once first).`,
          '',
          `- Failing since: ${s.failingSince}`,
          `- Last error: ${s.lastError}`,
          `- Uptime over the last 30 days: ${s.uptimePct}%`,
          runUrl ? `- Run: ${runUrl}` : '',
          '',
          'This issue closes by itself when the site passes again.',
        ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n'),
      });
    }
    if (s.status === 'up') {
      for (const issue of mine) {
        actions.push({ type: 'close', site: s.site, number: issue.number, comment: `${s.site} passed its last run${s.latestMs ? ` in ${s.latestMs} ms` : ''}. Closing.` });
      }
    }
  }
  // An issue for a site that is no longer watched (renamed or removed) would never see a recovery.
  const watched = new Set(summaries.map((s) => issueTitle(s.site)));
  for (const issue of openIssues) {
    const site = issue.title.match(/^Monitor: (.+) is down$/)?.[1];
    if (site && !watched.has(issue.title)) actions.push({ type: 'close', site, number: issue.number, comment: `${site} is no longer monitored. Closing.` });
  }
  return actions;
}
