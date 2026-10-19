import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';
// Public saucedemo test account (published on the site's login page); override with SAUCEDEMO_PASSWORD.
const PASSWORD = process.env.SAUCEDEMO_PASSWORD || 'secret_sauce';

test.describe('Cart Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', PASSWORD);
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  });

  test('item stays in the cart after opening another product @smoke', async ({ page }) => {
    await page.click('[data-test="item-0-title-link"]');
    // The second human fix (eval/runs/claude-code-2026-10-16/FIXES.md): without this
    // wait, the cart link was clicked before the details page had rendered in 5 of 20
    // runs, so the test didn't always exercise "after opening another product's details".
    await expect(page.locator('[data-test="back-to-products"]')).toBeVisible();
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(['Sauce Labs Backpack']);
  });

  test('badge still counts the item after reloading @regression', async ({ page }) => {
    await page.reload();

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });

  test('cart page matches the items that were added @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-fleece-jacket"]');
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(['Sauce Labs Backpack', 'Sauce Labs Fleece Jacket']);
  });
});
