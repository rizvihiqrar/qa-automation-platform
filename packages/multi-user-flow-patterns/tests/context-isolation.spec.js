import { test, expect } from '@playwright/test';
import { USERS } from '../fixtures/users.js';
import { createSession, teardownSession } from '../utils/userSession.js';

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
    await expect(sessionA.page).toHaveURL(/$/);

    // User B is still on the inventory page, unaffected
    await expect(sessionB.page).toHaveURL(/inventory/);
    await expect(sessionB.page.locator('.inventory_list')).toBeVisible();

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
    const firstItemA = await sessionA.page.locator('.inventory_item_name').first().innerText();
    const firstItemB = await sessionB.page.locator('.inventory_item_name').first().innerText();

    // Sort Z-A first item starts with T (Test.allTheThings() T-Shirt)
    // Sort hi-lo first item is the most expensive
    expect(firstItemA).not.toBe(firstItemB);

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

});
