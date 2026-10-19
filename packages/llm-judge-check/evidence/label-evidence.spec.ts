// Evidence for the labels that depend on how Playwright behaves, run against the
// live site. A "missing" label says an assertion would pass whether or not the outcome
// happened: each test below puts the site in a state where the outcome did NOT happen
// and shows the weak assertion passing anyway. H01 is the reverse: a label of
// "covered" for an unawaited expect, shown to fail when the value is wrong.
//
// Titles start with the variant key from labels/source.ts.
import { expect, test, type Page } from '@playwright/test';

const BASE_URL = 'https://www.saucedemo.com';

async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.fill('[data-test="username"]', 'standard_user');
  await page.fill('[data-test="password"]', 'secret_sauce');
  await page.click('[data-test="login-button"]');
  await expect(page).toHaveURL(/inventory\.html/);
}

test.beforeEach(async ({ page }) => login(page));

test('H01 an unawaited expect still fails the test when the value is wrong', async ({ page }) => {
  test.fail(); // the expected outcome: Playwright fails the test with "Test ended."
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
  void expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('3');
});

test('H01 an unawaited expect passes when the value is right', async ({ page }) => {
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
  void expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('2');
});

test('H02 data-test="cart-item" matches nothing on a cart page with an item in it', async ({ page }) => {
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('[data-test="shopping-cart-link"]');
  await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(1); // the cart is not empty
  await expect(page.locator('[data-test="cart-item"]')).toHaveCount(0); // and the weak check still passes
});

test('H03 a caught expect passes while there is no login button', async ({ page }) => {
  // still logged in: no login button on this page
  await expect(page.locator('[data-test="login-button"]')).toHaveCount(0);
  try {
    await expect(page.locator('[data-test="login-button"]')).toBeVisible({ timeout: 2000 });
  } catch {
    // swallowed, as in the variant
  }
});

// H04 was first labelled missing on the belief that a negative check passes when the
// element is absent. It doesn't: these two tests are why the label is now partial.
async function openCheckoutInfo(page: Page) {
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('[data-test="shopping-cart-link"]');
  await page.click('[data-test="checkout"]');
}

test('H04 not.toHaveText fails when no error is shown at all', async ({ page }) => {
  test.fail(); // expected: "element(s) not found"
  await openCheckoutInfo(page);
  await expect(page.locator('[data-test="error"]')).not.toHaveText('Error: Last Name is required', { timeout: 2000 });
});

test('H04 not.toHaveText passes when the wrong error is shown', async ({ page }) => {
  await openCheckoutInfo(page);
  await page.fill('[data-test="firstName"]', 'Ana');
  await page.fill('[data-test="lastName"]', 'Silva');
  await page.click('[data-test="continue"]');
  await expect(page.locator('[data-test="error"]')).toHaveText('Error: Postal Code is required'); // not the first-name error
  await expect(page.locator('[data-test="error"]')).not.toHaveText('Error: Last Name is required');
});

test('H05 the check passes without high to low ever being chosen', async ({ page }) => {
  // So a broken high-to-low option would not be noticed:
  await page.selectOption('[data-test="product-sort-container"]', 'lohi');
  await expect(page.locator('[data-test="inventory-item-name"]').last()).toHaveText('Sauce Labs Fleece Jacket');
});

test('H06 a check guarded by isVisible passes when no badge is shown', async ({ page }) => {
  await page.click('[data-test="item-4-title-link"]'); // nothing added
  const badge = page.locator('[data-test="shopping-cart-badge"]');
  await expect(badge).toHaveCount(0);
  if (await badge.isVisible()) {
    await expect(badge).toHaveText('1');
  }
});

test('H07 the pattern /2.4/ also matches other tax amounts', () => {
  for (const text of ['Tax: $12.48', 'Tax: $2.45', 'Tax: $204.00']) expect(text).toMatch(/2.4/);
});

test('V03 toHaveURL(/$/) passes on a page that is not the login page', async ({ page }) => {
  await expect(page).toHaveURL(/inventory\.html/);
  await expect(page).toHaveURL(/$/);
});
