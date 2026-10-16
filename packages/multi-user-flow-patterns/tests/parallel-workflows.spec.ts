import { test, expect } from '@playwright/test';
import { USERS } from '../fixtures/users.ts';
import { createSession, teardownSession, completeCheckout } from '../utils/userSession.ts';

test.describe('Pattern: Parallel workflow completion', () => {

  test('two users complete the full checkout workflow simultaneously @regression', async ({ browser }) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.standard),
    ]);

    await Promise.all([
      completeCheckout(sessionA.page, { firstName: 'Alice', lastName: 'Smith', zip: '10001' }),
      completeCheckout(sessionB.page, { firstName: 'Bob',   lastName: 'Jones', zip: '20002' }),
    ]);

    await Promise.all([
      expect(sessionA.page.locator('[data-test="complete-header"]')).toContainText('Thank you'),
      expect(sessionB.page.locator('[data-test="complete-header"]')).toContainText('Thank you'),
    ]);

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

  test('each user can independently navigate to different pages at the same time @regression', async ({ browser }) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.standard),
    ]);

    // At the same moment, User A opens the cart and User B adds an item
    await Promise.all([
      sessionA.page.click('[data-test="shopping-cart-link"]'),
      sessionB.page.click('[data-test="add-to-cart-sauce-labs-backpack"]'),
    ]);

    await Promise.all([
      expect(sessionA.page).toHaveURL(/cart/),
      expect(sessionB.page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1'),
    ]);

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

  test('parallel sessions do not slow each other down beyond a reasonable threshold @regression', async ({ browser }) => {
    const start = Date.now();

    const [sessionA, sessionB] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.glitch),
    ]);

    const elapsed = Date.now() - start;

    // Two logins running in parallel should complete well under the sum of their individual timeouts
    expect(elapsed).toBeLessThan(30000);

    await Promise.all([
      expect(sessionA.page).toHaveURL(/inventory/),
      expect(sessionB.page).toHaveURL(/inventory/),
    ]);

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

});
