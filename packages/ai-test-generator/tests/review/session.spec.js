// Review findings for feature-login.txt, feature-logout.txt and
// feature-reset-app-state.txt. See docs/requirement-review.
import { test, expect } from '@playwright/test';
import { PRODUCTS, BASE_URL, defect, login, loginAndWait, logout, addToCart } from './helpers.js';

const [backpack, bikeLight] = PRODUCTS;
const error = (page) => page.locator('[data-test="error"]');

test.describe('Login: review findings', () => {
  // "Valid credentials" never names a user. The site has five that log in.
  for (const user of ['standard_user', 'problem_user', 'performance_glitch_user', 'error_user', 'visual_user']) {
    test(`RV-17: ${user} reaches the products page @regression`, async ({ page }) => {
      await login(page, user);
      // The site delays performance_glitch_user's login on purpose: 5.1 to 5.2 s in
      // 8 of 8 timed runs, just over expect's default 5 s, so this check timed out
      // now and then (twice in CI). The finding is that the user gets in, not how fast.
      await expect(page).toHaveURL(/inventory\.html/, { timeout: 15_000 });
      await expect(page.locator('[data-test="title"]')).toHaveText('Products');
    });
  }

  // problem_user logs in like the rest, then "clicking a product's name opens its
  // details page" opens another product's page.
  defect('RV-27: clicking a product name opens that product\'s details for problem_user', async ({ page }) => {
    await loginAndWait(page, 'problem_user');
    await page.click(`[data-test="item-${backpack.id}-title-link"]`);
    await expect(page.locator('[data-test="back-to-products"]')).toBeVisible();
    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(backpack.name);
  });

  test('RV-18: a locked-out user with the wrong password gets the credentials error, not the lock message @regression', async ({ page }) => {
    await login(page, 'locked_out_user', 'wrong_password');
    await expect(error(page)).toContainText('Username and password do not match');
    await expect(error(page)).not.toContainText('locked out');
  });

  test('RV-19: a username without a password asks for the password @regression', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.click('[data-test="login-button"]');
    await expect(error(page)).toContainText('Password is required');
  });

  test('RV-19: a password without a username asks for the username @regression', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await expect(error(page)).toContainText('Username is required');
  });

  for (const [label, username] of [['upper case', 'STANDARD_USER'], ['a trailing space', 'standard_user ']]) {
    test(`RV-20: a username with ${label} is not accepted @regression`, async ({ page }) => {
      await login(page, username);
      await expect(error(page)).toContainText('Username and password do not match');
      await expect(page).not.toHaveURL(/inventory\.html/);
    });
  }

  // "At least one product" passes with five missing.
  test('RV-21: the products page lists exactly the six products @smoke', async ({ page }) => {
    await loginAndWait(page);
    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(
      PRODUCTS.map((p) => p.name).sort(),
    );
  });
});

test.describe('Logout: review findings', () => {
  // Only /inventory.html is named. Every other page needs the login too.
  for (const path of ['/cart.html', '/checkout-step-one.html', '/checkout-step-two.html', '/checkout-complete.html', '/inventory-item.html?id=1']) {
    test(`RV-22: ${path} is blocked when logged out @regression`, async ({ page }) => {
      await page.goto(BASE_URL + path);
      const name = path.split('?')[0];
      await expect(error(page)).toContainText(`You can only access '${name}' when you are logged in`);
      await expect(page.locator('[data-test="login-button"]')).toBeVisible();
    });
  }

  test('RV-23: the browser back button after logout does not show the products @smoke', async ({ page }) => {
    await loginAndWait(page);
    await logout(page);
    await page.goBack();
    await expect(page.locator('[data-test="login-button"]')).toBeVisible();
    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(0);
  });
});

test.describe('Reset app state: review findings', () => {
  // The three criteria are about the cart badge, the cart page and the login. The
  // list's own buttons are the fourth place the cart shows. The AI-generated tests
  // for this feature were all green while these still read "Remove".
  defect('RV-28: after reset, the products page buttons read Add to cart again', async ({ page }) => {
    await loginAndWait(page);
    await addToCart(page, backpack, bikeLight);
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="reset-sidebar-link"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
    await expect(page.locator(`[data-test="add-to-cart-${backpack.slug}"]`)).toHaveText('Add to cart');
    await expect(page.locator(`[data-test="add-to-cart-${bikeLight.slug}"]`)).toHaveText('Add to cart');
  });
});
