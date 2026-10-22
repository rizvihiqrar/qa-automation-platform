// Deliberately broken: the lint must report the bare count() (test/lint.test.mjs checks it).
import { expect, test } from '@playwright/test';

test('count() reads the page before the list is drawn', async ({ page }) => {
  await page.goto('https://www.saucedemo.com');
  const items = await page.locator('[data-test="inventory-item"]').count();
  expect(items).toBe(6);
});
