import { test, expect } from '@playwright/test';
import { USERS } from '../fixtures/users.ts';
import { createSession, teardownSession } from '../utils/userSession.ts';

test.describe('Pattern: Concurrent browser sessions', () => {

  test('two users can log in simultaneously in isolated browser contexts @smoke', async ({ browser }) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.standard),
    ]);

    await expect(sessionA.page).toHaveURL(/inventory/);
    await expect(sessionB.page).toHaveURL(/inventory/);

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

  test('standard user and performance_glitch user can be active at the same time @smoke', async ({ browser }) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.glitch),
    ]);

    // Both sessions land on the inventory page despite different user profiles
    await expect(sessionA.page).toHaveURL(/inventory/);
    await expect(sessionB.page).toHaveURL(/inventory/);

    // Both see the same product catalogue
    const countA = await sessionA.page.locator('[data-test="inventory-item"]').count();
    const countB = await sessionB.page.locator('[data-test="inventory-item"]').count();
    expect(countA).toBe(6);
    expect(countB).toBe(6);

    await Promise.all([teardownSession(sessionA), teardownSession(sessionB)]);
  });

  test('three concurrent sessions all land on the inventory page @regression', async ({ browser }) => {
    const [s1, s2, s3] = await Promise.all([
      createSession(browser, USERS.standard),
      createSession(browser, USERS.standard),
      createSession(browser, USERS.glitch),
    ]);

    await Promise.all([
      expect(s1.page).toHaveURL(/inventory/),
      expect(s2.page).toHaveURL(/inventory/),
      expect(s3.page).toHaveURL(/inventory/),
    ]);

    await Promise.all([teardownSession(s1), teardownSession(s2), teardownSession(s3)]);
  });

});
