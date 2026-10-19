import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';

test.describe('Checkout Complete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');
  });

  test('finishing shows the Checkout: Complete! page @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Complete!');
  });

  test('thank-you heading is shown @regression', async ({ page }) => {
    await expect(page.locator('[data-test="complete-header"]')).toHaveText('Thank you for your order!');
  });

  test.skip('cart badge is cleared after finishing @regression', async ({ page }) => {
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });

  test('back home returns to the products page @regression', async ({ page }) => {
    await page.click('[data-test="back-to-products"]');

    await expect(page).toHaveURL(/inventory\.html/);
  });
});
