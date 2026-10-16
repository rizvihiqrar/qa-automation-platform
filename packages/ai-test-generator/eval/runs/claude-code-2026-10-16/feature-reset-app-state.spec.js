import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';

test.describe('Reset App State', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="reset-sidebar-link"]');
  });

  test('reset removes the cart badge @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });

  test('cart page is empty after reset @regression', async ({ page }) => {
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(0);
  });

  test('user stays logged in on the products page after reset @regression', async ({ page }) => {
    await expect(page).toHaveURL(/inventory\.html/);
    await expect(page.locator('[data-test="title"]')).toHaveText('Products');
  });
});
