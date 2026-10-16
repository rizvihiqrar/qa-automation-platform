import { test, expect } from '@playwright/test';
import { USERS } from '../fixtures/users.ts';
import { createSession, teardownSession } from '../utils/userSession.ts';

test.describe('Pattern: Session state isolation', () => {

  test("User A's cart items do not appear in User B's cart @smoke", async ({ browser }) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.standard),
    ]);

    // User A adds 2 items
    await sessionA.page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await sessionA.page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');

    // User B adds 1 different item
    await sessionB.page.click('[data-test="add-to-cart-sauce-labs-bolt-t-shirt"]');

    const badgeA = sessionA.page.locator('[data-test="shopping-cart-badge"]');
    const badgeB = sessionB.page.locator('[data-test="shopping-cart-badge"]');

    await expect(badgeA).toHaveText('2');
    await expect(badgeB).toHaveText('1');

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

  test("User A logging out does not affect User B's active session @regression", async ({ browser }) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.standard),
    ]);

    // User A logs out
    await sessionA.page.click('#react-burger-menu-btn');
    await sessionA.page.click('[data-test="logout-sidebar-link"]');
    // This used to be toHaveURL(/$/), which matches every URL and so proved nothing.
    await expect(sessionA.page.locator('[data-test="login-button"]')).toBeVisible();
    await expect(sessionA.page).not.toHaveURL(/inventory/);

    // User B is still on the inventory page, unaffected
    await expect(sessionB.page).toHaveURL(/inventory/);
    await expect(sessionB.page.locator('[data-test="inventory-list"]')).toBeVisible();

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

  test("User B's sort preference does not affect User A's view @regression", async ({ browser }) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.standard),
    ]);

    // User B sorts by price high to low
    await sessionB.page.selectOption('[data-test="product-sort-container"]', 'hilo');

    // User A sorts by name Z to A
    await sessionA.page.selectOption('[data-test="product-sort-container"]', 'za');

    // Each user sees their own sort — first item names will differ
    const firstItemA = await sessionA.page.locator('[data-test="inventory-item-name"]').first().innerText();
    const firstItemB = await sessionB.page.locator('[data-test="inventory-item-name"]').first().innerText();

    // Assert each user's exact first item: only checking that they differ would also
    // pass if one sort silently didn't apply.
    expect(firstItemA).toBe('Test.allTheThings() T-Shirt (Red)');
    expect(firstItemB).toBe('Sauce Labs Fleece Jacket');

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

});
