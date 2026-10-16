import { test, expect } from '@playwright/test';
import { axeViolations, focusIssues, placeholderOnlyFields } from '../src/checks.js';

// The "before" site has known defects; each page must report exactly these axe rules.
const EXPECTED_BEFORE = {
  'index.html': ['color-contrast', 'document-title', 'html-has-lang', 'image-alt', 'link-name'],
  'product.html': ['button-name', 'select-name'],
  'checkout.html': ['color-contrast'],
};
const EXPECTED_FOCUS = { 'index.html': 3, 'product.html': 3, 'checkout.html': 4 };

test.describe('before: the audit finds every planted defect', () => {
  for (const [name, rules] of Object.entries(EXPECTED_BEFORE)) {
    test(`${name} reports exactly ${rules.join(', ')}`, async ({ page }) => {
      await page.goto(`/before/${name}`);
      const found = (await axeViolations(page)).map((v) => v.rule).sort();
      expect(found).toEqual(rules);
    });

    test(`${name} has ${EXPECTED_FOCUS[name]} element(s) with no visible focus`, async ({ page }) => {
      await page.goto(`/before/${name}`);
      expect(await focusIssues(page)).toHaveLength(EXPECTED_FOCUS[name]);
    });
  }

  test('axe accepts placeholder-only fields; the extra check catches all three', async ({ page }) => {
    await page.goto('/before/checkout.html');
    const axeRules = (await axeViolations(page)).map((v) => v.rule);
    expect(axeRules).not.toContain('label');
    const fields = await placeholderOnlyFields(page);
    expect(fields.map((f) => f.label)).toEqual(['Full name', 'Email', 'Postal code']);
  });
});

test.describe('after: the remediated site is clean', () => {
  for (const name of Object.keys(EXPECTED_BEFORE)) {
    test(`${name} has no WCAG A/AA violations, focus issues or placeholder-only fields @smoke`, async ({ page }) => {
      await page.goto(`/after/${name}`);
      expect(await axeViolations(page)).toEqual([]);
      expect(await focusIssues(page)).toEqual([]);
      expect(await placeholderOnlyFields(page)).toEqual([]);
    });
  }
});
