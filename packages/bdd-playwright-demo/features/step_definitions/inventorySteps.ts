import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { LoginPage } from '../../pageObjects/LoginPage.ts';
import { InventoryPage, type SortOption } from '../../pageObjects/InventoryPage.ts';
import type { PlaywrightWorld } from '../../support/world.ts';

// Public saucedemo test account (published on the site's login page); override with SAUCEDEMO_PASSWORD.
const PASSWORD = process.env.SAUCEDEMO_PASSWORD || 'secret_sauce';

const SORT_OPTIONS: readonly string[] = ['az', 'za', 'lohi', 'hilo'] satisfies SortOption[];

Given('I am logged in as {string}', async function (this: PlaywrightWorld, username: string) {
  const login = new LoginPage(this.page);
  await login.navigate();
  await login.enterUsername(username);
  await login.enterPassword(PASSWORD);
  await login.clickLogin();
  await this.page.waitForURL(/inventory/, { timeout: 15000 });
});

Then('I should see {int} products on the page', async function (this: PlaywrightWorld, expectedCount: number) {
  const inventory = new InventoryPage(this.page);
  const count = await inventory.getItemCount();
  expect(count).toBe(expectedCount);
});

When('I add {string} to the cart', async function (this: PlaywrightWorld, slug: string) {
  const inventory = new InventoryPage(this.page);
  await inventory.addToCart(slug);
});

Then('the cart badge should show {string}', async function (this: PlaywrightWorld, expectedBadge: string) {
  const inventory = new InventoryPage(this.page);
  const badge = await inventory.getCartBadge();
  expect(badge).toBe(expectedBadge);
});

// Feature files are plain text, so the sort value is checked here rather than by the compiler.
// An unknown value would otherwise time out inside selectOption with a less useful error.
When('I sort products by {string}', async function (this: PlaywrightWorld, sortValue: string) {
  if (!SORT_OPTIONS.includes(sortValue)) throw new Error(`Unknown sort "${sortValue}"; use one of ${SORT_OPTIONS.join(', ')}`);
  const inventory = new InventoryPage(this.page);
  await inventory.sortBy(sortValue as SortOption);
});

Then('the first product listed should be {string}', async function (this: PlaywrightWorld, expectedName: string) {
  const inventory = new InventoryPage(this.page);
  const firstName = await inventory.getFirstItemName();
  expect(firstName).toBe(expectedName);
});
