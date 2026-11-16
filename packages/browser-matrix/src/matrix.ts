import { chromium, firefox, webkit, type BrowserType } from '@playwright/test';
import { PAGE_HTML, PROBES, type Probe } from './probes.ts';

export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export type BrowserName = (typeof BROWSERS)[number];
export type Answers = Record<string, Record<BrowserName, string>>;

const TYPES: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

/** Asks every probe in one browser: a fresh page for each, so no answer depends on another. */
export async function askBrowser(name: BrowserName, probes: Probe[] = PROBES): Promise<Record<string, string>> {
  const browser = await TYPES[name].launch();
  try {
    const answers: Record<string, string> = {};
    for (const probe of probes) {
      const page = await (await browser.newContext({ locale: 'en-CA' })).newPage();
      await page.setContent(PAGE_HTML);
      answers[probe.id] = await probe.ask(page);
      await page.context().close();
    }
    return answers;
  } finally {
    await browser.close();
  }
}

/** The probes the browsers do not all answer the same way. */
export function differing(answers: Answers): string[] {
  return Object.entries(answers).filter(([, row]) => new Set(Object.values(row)).size > 1).map(([id]) => id);
}

/** Puts the answers of each browser side by side: one entry per probe, one answer per browser. */
export function combine(perBrowser: Record<BrowserName, Record<string, string>>, probes: Probe[] = PROBES): Answers {
  return Object.fromEntries(probes.map((p) => [p.id, { chromium: perBrowser.chromium[p.id] ?? '', firefox: perBrowser.firefox[p.id] ?? '', webkit: perBrowser.webkit[p.id] ?? '' }]));
}

const cell = (text: string) => '`' + text.replace(/`/g, "'").replace(/\|/g, '\\|') + '`';

/** The matrix as a Markdown table: one row per probe, one column per browser, and a mark where they differ. */
export function toTable(answers: Answers, probes: Probe[] = PROBES): string {
  const different = new Set(differing(answers));
  const lines = ['| Probe | ' + BROWSERS.join(' | ') + ' | Same? |', '|---|' + BROWSERS.map(() => '---|').join('') + '---|'];
  for (const probe of probes) {
    const row = answers[probe.id];
    if (!row) throw new Error(`no answers for ${probe.id}`);
    lines.push(`| ${probe.id} | ${BROWSERS.map((b) => cell(row[b])).join(' | ')} | ${different.has(probe.id) ? '**differs**' : 'same'} |`);
  }
  return lines.join('\n') + '\n';
}
