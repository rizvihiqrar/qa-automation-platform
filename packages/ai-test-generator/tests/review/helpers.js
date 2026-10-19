import { test, expect } from '@playwright/test';

export const BASE_URL = 'https://www.saucedemo.com';
// Public saucedemo test account (published on the site's login page); override with SAUCEDEMO_PASSWORD.
export const PASSWORD = process.env.SAUCEDEMO_PASSWORD || 'secret_sauce';

// The six products, in the page's default (Name A to Z) order, with the id the
// site uses in /inventory-item.html?id= and in its cart-contents storage key.
export const PRODUCTS = [
  { id: 4, slug: 'sauce-labs-backpack', name: 'Sauce Labs Backpack', cents: 2999 },
  { id: 0, slug: 'sauce-labs-bike-light', name: 'Sauce Labs Bike Light', cents: 999 },
  { id: 1, slug: 'sauce-labs-bolt-t-shirt', name: 'Sauce Labs Bolt T-Shirt', cents: 1599 },
  { id: 5, slug: 'sauce-labs-fleece-jacket', name: 'Sauce Labs Fleece Jacket', cents: 4999 },
  { id: 2, slug: 'sauce-labs-onesie', name: 'Sauce Labs Onesie', cents: 799 },
  { id: 3, slug: 'test.allthethings()-t-shirt-(red)', name: 'Test.allTheThings() T-Shirt (Red)', cents: 1599 },
];

export const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

// A test the requirement review proved should pass but does not: the site is
// wrong, not the test. It is marked expected-to-fail, so CI stays green while the
// defect exists and goes red the day the site is fixed (remove the wrapper then).
// REVIEW_SHOW_DEFECTS=1 leaves the marker off, to see each defect fail on its own.
export function defect(title, body) {
  test(`${title} [known defect]`, async ({ page }) => {
    if (!process.env.REVIEW_SHOW_DEFECTS) test.fail();
    await body({ page });
  });
}

export async function login(page, username = 'standard_user', password = PASSWORD) {
  await page.goto(BASE_URL);
  await page.fill('[data-test="username"]', username);
  await page.fill('[data-test="password"]', password);
  await page.click('[data-test="login-button"]');
}

export async function loginAndWait(page, username) {
  await login(page, username);
  await expect(page.locator('[data-test="title"]')).toHaveText('Products');
}

export async function logout(page) {
  await page.click('#react-burger-menu-btn');
  await page.click('[data-test="logout-sidebar-link"]');
  await expect(page.locator('[data-test="login-button"]')).toBeVisible();
}

export async function addToCart(page, ...products) {
  for (const p of products) await page.click(`[data-test="add-to-cart-${p.slug}"]`);
}

// Cart page -> Checkout -> information step filled in -> Overview.
export async function openOverview(page) {
  await page.click('[data-test="shopping-cart-link"]');
  await page.click('[data-test="checkout"]');
  await page.fill('[data-test="firstName"]', 'Ana');
  await page.fill('[data-test="lastName"]', 'Silva');
  await page.fill('[data-test="postalCode"]', 'L1S 2A1');
  await page.click('[data-test="continue"]');
  await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Overview');
}

// Signs in without the login form by setting the session cookie the site checks
// and the product ids it keeps in localStorage. Used where only the rule under
// test matters (tax on 63 carts), never to replace the UI path itself.
export async function seedSession(page, ids = [], username = 'standard_user') {
  await page.goto(BASE_URL);
  await page.context().addCookies([{ name: 'session-username', value: username, url: BASE_URL }]);
  await page.evaluate((cart) => localStorage.setItem('cart-contents', JSON.stringify(cart)), ids);
}
