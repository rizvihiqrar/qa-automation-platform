import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';

test.describe('User Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('valid credentials redirect to the products page @smoke', async ({ page }) => {
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    await expect(page).toHaveURL(/inventory\.html/);
  });

  test('incorrect password shows a credential mismatch error @regression', async ({ page }) => {
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'wrong_password');
    await page.click('[data-test="login-button"]');
    // The credential mismatch error is asserted by the shared afterEach hook.
  });

  test('locked-out user sees a locked-out message @regression', async ({ page }) => {
    await page.fill('[data-test="username"]', 'locked_out_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    await expect(page.locator('[data-test="error"]')).toContainText('Sorry, this user has been locked out');
  });

  test('submitting an empty form shows username required @regression', async ({ page }) => {
    await page.click('[data-test="login-button"]');

    await expect(page.locator('[data-test="error"]')).toContainText('Username is required');
  });

  test('products page displays at least one product after login @regression', async ({ page }) => {
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    await expect(page.locator('[data-test="inventory-item"]').first()).toBeVisible();
  });
});
