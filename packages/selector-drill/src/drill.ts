import type { Page } from '@playwright/test';
import { buildPage } from './page.ts';
import { DRILL, type Drill } from './selectors.ts';
import { applyVariant, VARIANTS, type Variant } from './variants.ts';

export const STYLES = ['recorded', 'css', 'xpath'] as const;
export type Style = (typeof STYLES)[number];

export interface Result {
  variant: Variant | 'before';
  style: Style;
  /** Keys whose selector still found exactly that element. */
  survived: string[];
  /** Keys whose selector found nothing, or more than one, or the wrong element. */
  broke: string[];
}

// The path a recorder writes: tag and position from the body down. Made from the page
// before any change, so it is exactly what "record a click" would have produced.
async function recordedPaths(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const el of Array.from(document.querySelectorAll('[data-key]'))) {
      const parts: string[] = [];
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
        const same = e.parentElement ? Array.from(e.parentElement.children) : [e];
        parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${same.indexOf(e) + 1})`);
      }
      out[el.getAttribute('data-key') as string] = 'body > ' + parts.join(' > ');
    }
    return out;
  });
}

// "Found it" means exactly one match and it is the element with the right data-key.
async function foundRightElement(page: Page, selector: string, key: string): Promise<boolean> {
  const keys = await page.locator(selector).evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
  return keys.length === 1 && keys[0] === key;
}

export async function measure(page: Page, drill: Drill[] = DRILL, only: readonly (Variant | 'before')[] = ['before', ...VARIANTS]): Promise<Result[]> {
  const results: Result[] = [];
  await page.setContent(buildPage());
  const recorded = await recordedPaths(page);
  const selectorFor = (style: Style, item: Drill): string =>
    style === 'recorded' ? (recorded[item.key] ?? '#no-such-key') : style === 'css' ? item.css : 'xpath=' + item.xpath;

  for (const variant of only) {
    await page.setContent(buildPage());
    if (variant !== 'before') await page.evaluate(applyVariant, variant);
    for (const style of STYLES) {
      const survived: string[] = [];
      const broke: string[] = [];
      for (const item of drill) {
        (await foundRightElement(page, selectorFor(style, item), item.key) ? survived : broke).push(item.key);
      }
      results.push({ variant, style, survived, broke });
    }
  }
  return results;
}

export const share = (r: Result): number => Math.round((100 * r.survived.length) / (r.survived.length + r.broke.length));
