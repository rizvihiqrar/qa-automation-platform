// Deliberately broken: the lint must report both calls (test/lint.test.mjs checks it).
import { expect, test } from '@playwright/test';

test('an unawaited expect races the end of the test', async ({ page }) => {
  await page.goto('https://www.saucedemo.com');
  expect(page.locator('[data-test="login-button"]')).toBeVisible();
  page.locator('[data-test="username"]').fill('standard_user');
  void expect(page).toHaveTitle('Swag Labs');
});
