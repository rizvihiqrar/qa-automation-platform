import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';

test.describe('Logout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="logout-sidebar-link"]');
  });

  test('logout returns to the login page @smoke', async ({ page }) => {
    await expect(page).toHaveURL(`${BASE_URL}/`);
  });

  test('login button is visible again after logout @regression', async ({ page }) => {
    await expect(page.locator('[data-test="login-button"]')).toBeVisible();
  });

  test('inventory is blocked after logout @regression', async ({ page }) => {
    await page.goto(`${BASE_URL}/inventory.html`);

    await expect(page.locator('[data-test="error"]')).toContainText(
      "You can only access '/inventory.html' when you are logged in"
    );
  });
});
