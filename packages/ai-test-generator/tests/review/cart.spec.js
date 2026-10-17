// Review findings for feature-cart-persistence.txt, feature-cart.txt and
// feature-product-details.txt (the cart-related parts). See docs/requirement-review.
import { test, expect } from '@playwright/test';
import { PRODUCTS, defect, login, loginAndWait, logout, addToCart, dollars } from './helpers.js';

const [backpack, bikeLight, , fleece] = PRODUCTS;

test.describe('Cart: review findings', () => {
  // The cart page is checked by name only in the AI-generated tests. "Match" and
  // "correct items" also mean price and quantity, and the order they were added in.
  test('RV-02: cart rows show name, price and quantity 1, in the order added @regression', async ({ page }) => {
    await loginAndWait(page);
    await addToCart(page, fleece, backpack);
    await page.click('[data-test="shopping-cart-link"]');

    const rows = page.locator('[data-test="inventory-item"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('[data-test="inventory-item-name"]')).toHaveText(fleece.name);
    await expect(rows.nth(0).locator('[data-test="inventory-item-price"]')).toHaveText(dollars(fleece.cents));
    await expect(rows.nth(0).locator('[data-test="item-quantity"]')).toHaveText('1');
    await expect(rows.nth(1).locator('[data-test="inventory-item-name"]')).toHaveText(backpack.name);
    await expect(rows.nth(1).locator('[data-test="inventory-item-price"]')).toHaveText(dollars(backpack.cents));
  });

  // "Still in the cart" never says whose cart. The site keeps one cart per browser.
  defect('RV-01: a different user does not inherit the previous user\'s cart', async ({ page }) => {
    await loginAndWait(page, 'standard_user');
    await addToCart(page, backpack);
    await logout(page);

    await login(page, 'visual_user');
    await expect(page.locator('[data-test="title"]')).toHaveText('Products');
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });

  // Opened with items already in the cart, the criterion "badge of 1" is false.
  test('RV-25: adding from the details page counts on top of what is already in the cart @regression', async ({ page }) => {
    await loginAndWait(page);
    await addToCart(page, backpack);
    await page.click(`[data-test="item-${bikeLight.id}-title-link"]`);
    await expect(page.locator('[data-test="back-to-products"]')).toBeVisible();
    await page.click('[data-test="add-to-cart"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('2');
    await expect(page.locator('[data-test="remove"]')).toBeVisible();
  });
});
