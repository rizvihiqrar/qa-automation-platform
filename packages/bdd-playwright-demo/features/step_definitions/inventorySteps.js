import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { LoginPage } from '../../pageObjects/LoginPage.js';
import { InventoryPage } from '../../pageObjects/InventoryPage.js';

Given('I am logged in as {string}', async function (username) {
  const login = new LoginPage(this.page);
  await login.navigate();
  await login.enterUsername(username);
  await login.enterPassword('secret_sauce');
  await login.clickLogin();
  await this.page.waitForURL(/inventory/, { timeout: 15000 });
});

Then('I should see {int} products on the page', async function (expectedCount) {
  const inventory = new InventoryPage(this.page);
  const count = await inventory.getItemCount();
  expect(count).toBe(expectedCount);
});

When('I add {string} to the cart', async function (slug) {
  const inventory = new InventoryPage(this.page);
  await inventory.addToCart(slug);
});

Then('the cart badge should show {string}', async function (expectedBadge) {
  const inventory = new InventoryPage(this.page);
  const badge = await inventory.getCartBadge();
  expect(badge).toBe(expectedBadge);
});

When('I sort products by {string}', async function (sortValue) {
  const inventory = new InventoryPage(this.page);
  await inventory.sortBy(sortValue);
});

Then('the first product listed should be {string}', async function (expectedName) {
  const inventory = new InventoryPage(this.page);
  const firstName = await inventory.getFirstItemName();
  expect(firstName).toBe(expectedName);
});
