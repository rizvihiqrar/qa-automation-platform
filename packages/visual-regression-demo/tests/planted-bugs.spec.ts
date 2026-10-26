import { expect, test, type Page } from '@playwright/test';
import { open, PHONE, requireBaseline } from './helpers.ts';

// Each test puts one visual bug on a page that already has a baseline and expects the comparison to
// SEE it: `not.toHaveScreenshot` passes only when the picture differs. If a bug ever slips through,
// the suite has gone blind and this file fails. The bugs are the kind a human reviewer misses.
const SHOT = { fullPage: true } as const;
const plant = (page: Page, css: string) => page.addStyleTag({ content: css });

test.describe('light desktop', () => {
  test.use({ colorScheme: 'light' });

  test('a button a few shades off is caught', async ({ page }, info) => {
    await open(page, '#/', 'Accounts');
    await plant(page, '.btn { background: #1c2128; border-color: #1c2128; }'); // #111418 became #1c2128
    requireBaseline(info, 'accounts-light.png');
    await expect(page).not.toHaveScreenshot('accounts-light.png', SHOT);
  });

  test("Playwright's default tolerance would miss that same button", async ({ page }, info) => {
    await open(page, '#/', 'Accounts');
    await plant(page, '.btn { background: #1c2128; border-color: #1c2128; }');
    requireBaseline(info, 'accounts-light.png');
    await expect(page).toHaveScreenshot('accounts-light.png', { ...SHOT, threshold: 0.2 });
  });

  test('a heading margin 4 px too tall is caught', async ({ page }, info) => {
    await open(page, '#/accounts/1', "Ada Lovelace's USD Account");
    await plant(page, 'h1 { margin-bottom: 12px; }'); // everything below moves down 4 px
    requireBaseline(info, 'statement-light.png');
    await expect(page).not.toHaveScreenshot('statement-light.png', SHOT);
  });

  test('a missing button is caught', async ({ page }, info) => {
    await open(page, '#/', 'Accounts');
    await plant(page, '.btn { visibility: hidden; }'); // still in the layout, not on screen
    requireBaseline(info, 'accounts-light.png');
    await expect(page).not.toHaveScreenshot('accounts-light.png', SHOT);
  });

  test('a clipped balance is caught', async ({ page }, info) => {
    await open(page, '#/accounts/1', "Ada Lovelace's USD Account");
    await plant(page, '.balance strong { display: inline-block; width: 3ch; overflow: hidden; vertical-align: bottom; }');
    requireBaseline(info, 'statement-light.png');
    await expect(page).not.toHaveScreenshot('statement-light.png', SHOT);
  });
});

test.describe('dark desktop', () => {
  test.use({ colorScheme: 'dark' });

  test('unreadable text in dark mode is caught', async ({ page }, info) => {
    await open(page, '#/', 'Accounts');
    await plant(page, ':root[data-theme="dark"] { --text: #0f1115; }'); // text the colour of the page
    requireBaseline(info, 'accounts-dark.png');
    await expect(page).not.toHaveScreenshot('accounts-dark.png', SHOT);
  });
});

test.describe('light phone', () => {
  test.use({ colorScheme: 'light', viewport: PHONE });

  test('a column that wraps on a phone is caught', async ({ page }, info) => {
    await open(page, '#/accounts/1', "Ada Lovelace's USD Account");
    await plant(page, 'th, td { white-space: normal; }'); // the statement table stops scrolling and wraps instead
    requireBaseline(info, 'statement-light-phone.png');
    await expect(page).not.toHaveScreenshot('statement-light-phone.png', SHOT);
  });
});
