// Review findings for feature-inventory-sort.txt and feature-product-details.txt.
// See docs/requirement-review.
import { test, expect } from '@playwright/test';
import { PRODUCTS, BASE_URL, loginAndWait, dollars } from './helpers.js';

const byName = [...PRODUCTS].sort((a, b) => (a.name < b.name ? -1 : 1));

// Whole-list order for each sort. The two $15.99 shirts tie on price; the site
// keeps them in name order for both price sorts. Nothing in the criteria says so,
// so the tie order is recorded as observed (RV-15), not as a requirement.
const ORDER = {
  az: byName.map((p) => p.name),
  za: [...byName].reverse().map((p) => p.name),
  lohi: ['Sauce Labs Onesie', 'Sauce Labs Bike Light', 'Sauce Labs Bolt T-Shirt', 'Test.allTheThings() T-Shirt (Red)', 'Sauce Labs Backpack', 'Sauce Labs Fleece Jacket'],
  hilo: ['Sauce Labs Fleece Jacket', 'Sauce Labs Backpack', 'Sauce Labs Bolt T-Shirt', 'Test.allTheThings() T-Shirt (Red)', 'Sauce Labs Bike Light', 'Sauce Labs Onesie'],
};

test.describe('Inventory sorting: review findings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndWait(page);
  });

  // The AI-generated test says "6 products after any sort" and tries one sort.
  for (const sort of Object.keys(ORDER)) {
    test(`RV-14: six products are shown after sorting by ${sort} @regression`, async ({ page }) => {
      await page.selectOption('[data-test="product-sort-container"]', sort);
      await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(6);
    });

    test(`RV-15: the whole list is in order after sorting by ${sort} @regression`, async ({ page }) => {
      await page.selectOption('[data-test="product-sort-container"]', sort);
      await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(ORDER[sort]);
    });
  }
});

test.describe('Product details: review findings', () => {
  // The criterion is checked for one product. Name, price and description for all six.
  test('RV-24: every product\'s details page matches its card on the list @regression', async ({ page }) => {
    await loginAndWait(page);
    const cards = await page.locator('[data-test="inventory-item"]').evaluateAll((els) => els.map((el) => ({
      name: el.querySelector('[data-test="inventory-item-name"]').textContent,
      price: el.querySelector('[data-test="inventory-item-price"]').textContent,
      desc: el.querySelector('[data-test="inventory-item-desc"]').textContent,
    })));
    expect(cards.map((c) => c.name).sort()).toEqual(PRODUCTS.map((p) => p.name).sort());

    for (const p of PRODUCTS) {
      await page.goto(`${BASE_URL}/inventory-item.html?id=${p.id}`);
      await expect(page.locator('[data-test="back-to-products"]')).toBeVisible();
      const card = cards.find((c) => c.name === p.name);
      await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(p.name);
      await expect(page.locator('[data-test="inventory-item-price"]')).toHaveText(card.price);
      await expect(page.locator('[data-test="inventory-item-price"]')).toHaveText(dollars(p.cents));
      await expect(page.locator('[data-test="inventory-item-desc"]')).toHaveText(card.desc);
    }
  });

  test('RV-26: an unknown product id shows an item-not-found page with a way back @regression', async ({ page }) => {
    await loginAndWait(page);
    await page.goto(`${BASE_URL}/inventory-item.html?id=99`);
    await expect(page.getByText('ITEM NOT FOUND')).toBeVisible();
    await page.click('[data-test="back-to-products"]');
    await expect(page.locator('[data-test="title"]')).toHaveText('Products');
  });
});
