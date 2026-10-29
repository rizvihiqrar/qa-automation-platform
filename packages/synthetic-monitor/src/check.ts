// One check: open the page in a fresh browser context and see that it loaded, has the right
// title and shows the right element. The first failure is retried once inside the run, so a
// single dropped connection does not count against a site.
import type { Browser } from '@playwright/test';
import type { Site } from './sites.ts';
import type { SiteResult } from './history.ts';

export interface CheckOptions {
  /** Longest a page may take to load, and then to show its element. */
  timeoutMs?: number;
  /** Wait before the retry. */
  retryDelayMs?: number;
}

const shorten = (message: string) => message.split('\n')[0]!.replace(/\s+/g, ' ').slice(0, 200);

async function attempt(browser: Browser, site: Site, timeoutMs: number): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const start = Date.now();
    const response = await page.goto(site.url, { waitUntil: 'load', timeout: timeoutMs });
    const ms = Date.now() - start;
    if (!response) return { ok: false, error: 'no response' };
    if (response.status() >= 400) return { ok: false, error: `HTTP ${response.status()}` };
    const title = await page.title();
    if (!site.title.test(title)) return { ok: false, error: `title was "${title.slice(0, 80)}", expected ${site.title}` };
    // One deadline for the whole attempt: the element gets what the load left of it.
    await page.locator(site.selector).first().waitFor({ state: 'visible', timeout: Math.max(1, timeoutMs - ms) });
    return { ok: true, ms };
  } catch (err) {
    return { ok: false, error: shorten(err instanceof Error ? err.message : String(err)) };
  } finally {
    await context.close();
  }
}

export async function checkSite(browser: Browser, site: Site, { timeoutMs = 15_000, retryDelayMs = 2_000 }: CheckOptions = {}): Promise<SiteResult> {
  const first = await attempt(browser, site, timeoutMs);
  if (first.ok) return { ok: true, ms: first.ms, attempts: 1 };
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  const second = await attempt(browser, site, timeoutMs);
  if (second.ok) return { ok: true, ms: second.ms, attempts: 2 };
  return { ok: false, ms: null, error: second.error, attempts: 2 };
}
