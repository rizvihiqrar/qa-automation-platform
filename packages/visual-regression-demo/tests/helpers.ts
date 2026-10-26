import fs from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

// A planted-bug test compares against a baseline that tests/pages.spec.ts makes. Without one, Playwright would
// write the BUGGY picture as the baseline, so the test stops first: it skips on a first local run and fails in CI.
export function requireBaseline(info: TestInfo, name: string) {
  if (fs.existsSync(info.snapshotPath(name))) return;
  if (process.env.CI) throw new Error(`no baseline ${name}: the planted-bug tests need the page baselines committed`);
  test.skip(true, `no baseline ${name} yet: run tests/pages.spec.ts first`);
}

export const PHONE = { width: 390, height: 844 };

// Opens one page of the banking UI and waits until it has drawn: the heading is there, the web
// fonts (none, but the check is free) are settled, and nothing is still loading.
export async function open(page: Page, hash: string, heading: string) {
  await page.goto(`/${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  await page.evaluate(() => document.fonts.ready);
}

// The refusal pages: type into a form and send it, so the error and the red field are on screen.
export async function refuse(page: Page, form: string, amount: string) {
  const f = page.locator(`[data-cy="${form}-form"]`);
  await f.locator('[data-cy="amount"], [data-cy="owner"]').first().fill(amount);
  await f.locator('[data-cy="submit"]').click();
  await expect(f.locator('[data-cy="error"]')).not.toBeEmpty();
}

// Every page the suite photographs: its baseline name, where it lives and the heading to wait for.
export const PAGES = [
  { name: 'accounts', hash: '#/', heading: 'Accounts' },
  { name: 'statement', hash: '#/accounts/1', heading: "Ada Lovelace's USD Account" },
  { name: 'empty-statement', hash: '#/accounts/3', heading: "Alan Turing's CAD Account" },
  { name: 'not-found', hash: '#/accounts/999', heading: 'Account Not Found' },
] as const;
