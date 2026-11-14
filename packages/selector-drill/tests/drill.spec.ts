import { test, expect, type Page } from '@playwright/test';
import { measure, share, type Result } from '../src/drill.ts';
import { buildPage } from '../src/page.ts';
import { DRILL, type Drill } from '../src/selectors.ts';
import { renderReport } from '../src/report.ts';
import { VARIANTS } from '../src/variants.ts';

// SD-xx: the drill measures what it says, and the selectors are as good or as bad as
// they are marked. One measurement (5 pages, 90 selectors each) is shared by the tests.
test.describe.configure({ mode: 'serial' });

let page: Page;
let results: Result[];
const get = (variant: string, style: string) => results.find((r) => r.variant === variant && r.style === style) as Result;
const weakKeys = (style: 'css' | 'xpath') => DRILL.filter((d) => d.weak?.[style]).map((d) => d.key).sort();

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120000); // the measurement is about 450 lookups; a slow runner gets room
  page = await browser.newPage();
  results = await measure(page);
});
test.afterAll(async () => { await page.close(); });

test('SD-01 the page has 30 elements, each with its own key, and the drill has a selector pair for each', async () => {
  await page.setContent(buildPage());
  const keys = await page.locator('[data-key]').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
  expect(keys).toHaveLength(30);
  expect(new Set(keys).size).toBe(30);
  expect(DRILL.map((d) => d.key).sort()).toEqual([...keys].sort() as string[]);
});

test('SD-02 before any change every selector, in all three styles, finds its element and only it', async () => {
  for (const style of ['recorded', 'css', 'xpath']) {
    expect(get('before', style).broke, `${style} on the unchanged page`).toEqual([]);
    expect(share(get('before', style))).toBe(100);
  }
});

test('SD-03 an added wrapper and banner breaks every recorded path', async () => {
  expect(share(get('wrap', 'recorded'))).toBe(0);
});

test('SD-04 renamed classes break no recorded path (they hold no classes) but break the class-based CSS ones', async () => {
  expect(share(get('rename', 'recorded'))).toBe(100);
  expect(get('rename', 'css').broke).toContain('chip-late');
});

test('SD-05 reordering breaks most recorded paths and the position-based selectors', async () => {
  expect(share(get('reorder', 'recorded'))).toBeLessThan(50);
  expect(get('reorder', 'css').broke).toContain('row-1003-checkbox');
  expect(get('reorder', 'xpath').broke).toEqual(expect.arrayContaining(['nav-help', 'speed-express']));
});

test('SD-06 after the full redesign the hand-written selectors keep at least 85% and the recorded paths at most 10%', async () => {
  expect(share(get('redesign', 'recorded'))).toBeLessThanOrEqual(10);
  expect(share(get('redesign', 'css'))).toBeGreaterThanOrEqual(85);
  expect(share(get('redesign', 'xpath'))).toBeGreaterThanOrEqual(85);
});

test('SD-07 only the selectors marked weak ever break, and each marked one breaks in at least one change', async () => {
  for (const style of ['css', 'xpath'] as const) {
    const weak = weakKeys(style);
    const everBroken = new Set<string>();
    for (const v of VARIANTS) for (const k of get(v, style).broke) everBroken.add(k);
    expect([...everBroken].sort(), `${style}: the selectors that broke`).toEqual(weak);
  }
});

test('SD-08 the selectors follow their own rules: the unmarked ones have no class, position or child chain, the marked ones do', async () => {
  const bad = /\.[a-z]|nth-child|\[\d+\]|\)\[\d+\]| > |data-key/i;
  for (const d of DRILL) {
    for (const style of ['css', 'xpath'] as const) {
      const text = d[style];
      expect(/data-key/.test(text), `${d.key} ${style} uses the answer sheet`).toBe(false);
      expect(bad.test(text), `${d.key} ${style}: "${text}" ${d.weak?.[style] ? 'is marked weak but looks fine' : 'looks weak but is not marked'}`).toBe(Boolean(d.weak?.[style]));
    }
  }
});

test('SD-09 a selector that finds two elements, or the wrong one, counts as broken', async () => {
  const one = DRILL[1] as Drill; // nav-home
  const two = DRILL.find((d) => d.key === 'terms') as Drill;
  const trap: Drill[] = [
    { ...one, css: 'a' },                    // matches every link
    { ...two, css: 'a[href="/privacy"]' },   // matches exactly one, but another element
  ];
  const [before] = (await measure(page, trap, ['before'])).filter((r) => r.style === 'css');
  expect((before as Result).broke).toEqual([one.key, two.key]);
});

test('SD-11 the numbers in the README table are the measured ones', async () => {
  const table: Record<string, [number, number, number]> = {
    before: [100, 100, 100], wrap: [0, 97, 97], rename: [100, 93, 100], reorder: [37, 97, 93], redesign: [0, 90, 93],
  };
  for (const [variant, expected] of Object.entries(table)) {
    expect(['recorded', 'css', 'xpath'].map((s) => share(get(variant, s))), variant).toEqual(expected);
  }
});

test('SD-10 the report shows the table, what broke and the rules', async () => {
  const text = renderReport(results);
  expect(text).toContain('| redesign |');
  expect(text).toContain('**css, redesign** (3): chip-late, row-1003-checkbox, order-total');
  expect(text).toContain('## Rules');
  expect(text.match(/^\d\. /gm)).toHaveLength(6);
});
