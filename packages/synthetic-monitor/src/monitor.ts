// One monitoring run over a list of sites. Kept apart from run.ts (which launches the browser and
// touches files) so a test can drive it with a fake site.
import type { Browser } from '@playwright/test';
import { checkSite, type CheckOptions } from './check.ts';
import { append, summarize, type History, type Run, type SiteSummary } from './history.ts';
import type { Site } from './sites.ts';

export class MonitorBroken extends Error {}

export interface MonitorResult {
  run: Run;
  history: History;
  summaries: SiteSummary[];
}

/**
 * Checks every site and adds the result to the history. A site that is down is a result. When every
 * site fails in the same run the runner has no connection, so no result can be trusted: this throws
 * MonitorBroken and the history is left as it was.
 */
export async function monitor(browser: Browser, sites: Site[], history: History, now: Date, options: CheckOptions = {}): Promise<MonitorResult> {
  const run: Run = { t: now.toISOString(), results: {} };
  for (const site of sites) run.results[site.name] = await checkSite(browser, site, options);
  if (sites.length > 1 && Object.values(run.results).every((r) => !r.ok)) {
    throw new MonitorBroken('Every site failed in this run: the monitor has no connection, so nothing was saved.');
  }
  const next = append(history, run);
  return { run, history: next, summaries: summarize(next) };
}
