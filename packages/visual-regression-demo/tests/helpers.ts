import { expect, type Page } from '@playwright/test';

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
