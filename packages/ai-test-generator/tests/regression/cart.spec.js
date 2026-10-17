import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';

test.describe('Shopping Cart', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('adding a product sets the cart badge to 1 @smoke', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });

  test('adding two different products shows a badge of 2 @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('2');
  });

  test('removing a product decrements the badge @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('[data-test="remove-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });

  test('removing the last item hides the badge @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="remove-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });

  test('cart page lists the items that were added @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(['Sauce Labs Backpack', 'Sauce Labs Bike Light']);
  });
});
