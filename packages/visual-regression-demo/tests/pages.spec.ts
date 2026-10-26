import { expect, test } from '@playwright/test';
import { open, PAGES, PHONE, refuse } from './helpers.ts';

// One baseline per page, in light and dark, at desktop and phone width. The pages read only the
// fixed accounts from src/serve.ts, and the refusals change nothing, so the tests can run in any order.
const SHOT = { fullPage: true } as const;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} desktop`, () => {
    test.use({ colorScheme: scheme });

    for (const { name, hash, heading } of PAGES) {
      test(`${name} page`, async ({ page }) => {
        await open(page, hash, heading);
        await expect(page).toHaveScreenshot(`${name}-${scheme}.png`, SHOT);
      });
    }

    test('open-account form after a refusal', async ({ page }) => {
      await open(page, '#/', 'Accounts');
      await refuse(page, 'open', '');
      await expect(page).toHaveScreenshot(`open-refused-${scheme}.png`, SHOT);
    });

    test('withdrawal refused for lack of funds', async ({ page }) => {
      await open(page, '#/accounts/3', "Alan Turing's CAD Account");
      await refuse(page, 'withdraw', '10.00');
      await expect(page).toHaveScreenshot(`withdraw-refused-${scheme}.png`, SHOT);
    });
  });

  test.describe(`${scheme} phone`, () => {
    test.use({ colorScheme: scheme, viewport: PHONE });

    for (const { name, hash, heading } of PAGES.filter((p) => p.name === 'accounts' || p.name === 'statement')) {
      test(`${name} page`, async ({ page }) => {
        await open(page, hash, heading);
        await expect(page).toHaveScreenshot(`${name}-${scheme}-phone.png`, SHOT);
      });
    }
  });
}
