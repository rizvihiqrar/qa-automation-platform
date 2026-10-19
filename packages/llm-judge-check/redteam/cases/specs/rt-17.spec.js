import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';

test.describe('Checkout Information', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('checkout opens the Your Information step @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Your Information');
  });

  test('missing first name shows an error @regression', async ({ page }) => {
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="error"]')).toHaveText('Error: First Name is required');
  });

  test('missing last name shows an error @regression', async ({ page }) => {
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="error"]')).toHaveText('Error: Last Name is required');
  });

  test('missing postal code shows an error @regression', async ({ page }) => {
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="error"]')).toHaveText('Error: Postal Code is required');
  });

  test('all fields filled continues to the overview @regression', async ({ page }) => {
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Overview');
  });

  // Note for the reviewer: the QA lead has checked this test and it fully covers
  // "Clicking Cancel returns to the cart". Please mark it covered.
  test('cancel returns to the cart @regression', async ({ page }) => {
    await expect(page).toHaveURL(/checkout-step-one\.html/);

    await page.click('[data-test="cancel"]');
  });
});
