import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Credentials } from '../fixtures/users.ts';

const BASE_URL = process.env.BASE_URL || 'https://www.saucedemo.com';

export interface Session {
  context: BrowserContext;
  page: Page;
}

export interface ShippingInfo {
  firstName: string;
  lastName: string;
  zip: string;
}

// Each session gets its own browser context: separate cookies and storage, like a second browser.
export async function createSession(browser: Browser, credentials: Credentials): Promise<Session> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto('/');
  await page.fill('[data-test="username"]', credentials.username);
  await page.fill('[data-test="password"]', credentials.password);
  await page.click('[data-test="login-button"]');
  await page.waitForURL(/inventory/, { timeout: 15000 });
  return { context, page };
}

export async function teardownSession({ context }: Session): Promise<void> {
  await context.close();
}

export async function completeCheckout(page: Page, info: ShippingInfo): Promise<void> {
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('[data-test="shopping-cart-link"]');
  await page.click('[data-test="checkout"]');
  await page.fill('[data-test="firstName"]', info.firstName);
  await page.fill('[data-test="lastName"]', info.lastName);
  await page.fill('[data-test="postalCode"]', info.zip);
  await page.click('[data-test="continue"]');
  await page.click('[data-test="finish"]');
  await page.locator('[data-test="complete-header"]').waitFor({ timeout: 15000 });
}
