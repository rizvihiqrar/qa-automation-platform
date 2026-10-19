import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';
// Public saucedemo test account (published on the site's login page); override with SAUCEDEMO_PASSWORD.
const PASSWORD = process.env.SAUCEDEMO_PASSWORD || 'secret_sauce';

test.describe('Inventory Sorting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', PASSWORD);
    await page.click('[data-test="login-button"]');
  });

  test('default sort is name A to Z with Sauce Labs Backpack first @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="product-sort-container"]')).toHaveValue('az');
    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Backpack');
  });

  test('name Z to A shows the red T-shirt first @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'za');

    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Test.allTheThings() T-Shirt (Red)');
  });

  test('price low to high shows the Onesie first at $7.99 @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'lohi');

    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Onesie');
    await expect(page.locator('[data-test="inventory-item-price"]').first()).toHaveText('$7.99');
  });

  test('price high to low shows the Fleece Jacket first at $49.99 @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'hilo');

    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Fleece Jacket');
    await expect(page.locator('[data-test="inventory-item-price"]').first()).toHaveText('$49.99');
  });

  test('six products are shown after sorting @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'hilo');

    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(6);
  });
});
