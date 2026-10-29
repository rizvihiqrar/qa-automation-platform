// One monitoring run: check every site, append the result to <data>/history.json and rewrite
// <data>/summary.json (what the dashboard reads).
//
//   node src/run.ts --data <folder>      (BROWSER=firefox to use Firefox; chromium by default)
//
// A site that is down is not an error here: it is a result, and the alert step turns it into an
// issue. This exits 1 only when the monitor itself cannot do its job: no browser, or every site
// failed in the same run (see monitor.ts).
import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox } from '@playwright/test';
import type { History } from './history.ts';
import { monitor, MonitorBroken } from './monitor.ts';
import { SITES } from './sites.ts';

const i = process.argv.indexOf('--data');
const dataDir = path.resolve((i >= 0 ? process.argv[i + 1] : undefined) ?? 'data');
const historyFile = path.join(dataDir, 'history.json');

const readHistory = (): History => {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf8')) as History;
    return Array.isArray(parsed.runs) ? parsed : { runs: [] };
  } catch {
    return { runs: [] };
  }
};

const browser = await (process.env.BROWSER === 'firefox' ? firefox : chromium).launch();
try {
  const { run, history, summaries } = await monitor(browser, SITES, readHistory(), new Date());
  for (const [name, r] of Object.entries(run.results)) {
    console.log(`${r.ok ? 'up  ' : 'DOWN'} ${name.padEnd(16)} ${r.ok ? `${r.ms} ms` : r.error}${r.attempts > 1 ? ' (needed the retry)' : ''}`);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify(history));
  fs.writeFileSync(path.join(dataDir, 'summary.json'), JSON.stringify({ generatedAt: run.t, sites: summaries }, null, 2));
  console.log(`${history.runs.length} runs kept in ${historyFile}`);
} catch (err) {
  if (!(err instanceof MonitorBroken)) throw err;
  console.error(`::error::${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
