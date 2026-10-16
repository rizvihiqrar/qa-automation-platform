import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';

test.describe('Product Details', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('clicking a product name opens its details page @smoke', async ({ page }) => {
    await page.click('[data-test="item-4-title-link"]');

    await expect(page).toHaveURL(/inventory-item\.html\?id=4/);
  });

  test('details page shows the same name and price as the list @regression', async ({ page }) => {
    const listName = await page.locator('[data-test="inventory-item-name"]').first().innerText();
    const listPrice = await page.locator('[data-test="inventory-item-price"]').first().innerText();

    await page.locator('[data-test="inventory-item-name"]').first().click();

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(listName);
    await expect(page.locator('[data-test="inventory-item-price"]')).toHaveText(listPrice);
  });

  test('adding from the details page sets the cart badge to 1 @regression', async ({ page }) => {
    await page.click('[data-test="item-4-title-link"]');
    await page.click('[data-test="add-to-cart"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });

  test('back to products returns to the products page @regression', async ({ page }) => {
    await page.click('[data-test="item-4-title-link"]');
    await page.click('[data-test="back-to-products"]');

    await expect(page).toHaveURL(/inventory\.html/);
  });
});
