// Deliberately broken: the lint must report each state read kept in a variable
// (test/lint.test.mjs checks the lines). The last test is the fix and must not be reported.
import { expect, test } from '@playwright/test';

test('a stored state read goes stale', async ({ page }) => {
  await page.goto('https://www.saucedemo.com');
  const badge = page.locator('[data-test="shopping-cart-badge"]');
  const visible = await badge.isVisible();
  const text = await badge.textContent();
  const link = await page.locator('a').first().getAttribute('href');
  if (visible) expect(text).toBe('1');
  expect(link).toBeTruthy();
});

test('the Locator is kept and asserted on, which waits', async ({ page }) => {
  await page.goto('https://www.saucedemo.com');
  const badge = page.locator('[data-test="shopping-cart-badge"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('1');
});
