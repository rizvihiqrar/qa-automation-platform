// The human labels and the variant cases. Judges never see this folder: they get only
// the rubric (judge/prompt.md) and the blind cases built from this file by
// src/build-cases.ts (cases/items.json and cases/specs/).
//
// Real cases: the 43 acceptance criteria of the ten Day 4 feature files, each judged
// against the unedited AI-written spec for its feature
// (ai-test-generator/eval/runs/claude-code-2026-10-16).
//
// Variants: the same specs with one test weakened (or rewritten) on purpose, so the
// set has enough `partial` and `missing` cases to measure a judge on. Their label is
// known by construction. Each `find` must occur exactly once in the base spec.

export type Verdict = 'covered' | 'partial' | 'missing';

export interface RealLabel {
  feature: string; // examples/input/feature-<feature>.txt
  c: number; // criterion number in the file, 1-based (C1, C2, ...)
  label: Verdict;
  reason: string;
  borderline?: string; // why a careful reader could answer differently
  draft?: Verdict; // set where the reviewer changed the drafted label
}

export interface Variant {
  key: string; // V01..V16, H01..H08
  feature: string;
  c: number;
  label: Verdict;
  reason: string;
  borderline?: string;
  draft?: Verdict;
  find: string;
  replace: string;
}

export const REAL: RealLabel[] = [
  {
    feature: 'cart-persistence', c: 1, label: 'partial', draft: 'covered',
    reason: 'Never waits for the details page before opening the cart: run 20 times, the page had not rendered before the cart click in 5, so a bug triggered by loading the details page would pass about 1 run in 4. Waiting for the Back button first (as in FIXES.md) would make it covered.',
    borderline: 'The address reached the details page every time; the page just was not drawn yet.',
  },
  { feature: 'cart-persistence', c: 2, label: 'covered', reason: 'Reloads the products page and checks the badge reads 1.' },
  {
    feature: 'cart-persistence', c: 3, label: 'partial', draft: 'covered',
    reason: 'Checks the exact names and order (catches missing, extra and wrong items) but not price or quantity; a cart with the right names and wrong prices would pass. Matches Day 35\'s names-only gap.',
    borderline: 'Day 35 (RV-02) counted names only as a test gap: price and quantity are not compared.',
  },

  {
    feature: 'cart', c: 1, label: 'covered',
    reason: 'Its own test only checks 0 to 1, which cannot tell "+1" from "set to 1", but the C2 test in the same file adds two products and checks the badge reads 2, which fails for those bugs (rule 5, as on logout C1).',
    borderline: 'Relabelled partial in review, then back to covered after the rubric-v2 judges pointed out the C2 test: the judges found an inconsistency in the labels, not the other way round.',
  },
  { feature: 'cart', c: 2, label: 'covered', reason: 'Adds two different products and checks the badge reads 2.' },
  { feature: 'cart', c: 3, label: 'covered', reason: 'Goes from 2 items to 1 and checks the badge reads 1.' },
  { feature: 'cart', c: 4, label: 'covered', reason: 'Removes the only item and checks the badge is not on the page.' },
  {
    feature: 'cart', c: 5, label: 'partial', draft: 'covered',
    reason: 'Same as cart-persistence C3: names and order only, no price or quantity. Labelled the same for consistency.',
    borderline: 'Paired with cart-persistence C3: "correct items" reads slightly more like "the right products" than "match" does.',
  },

  { feature: 'checkout-complete', c: 1, label: 'covered', reason: 'Clicks Finish and checks the title reads "Checkout: Complete!".' },
  { feature: 'checkout-complete', c: 2, label: 'covered', reason: 'Checks the heading text exactly.' },
  { feature: 'checkout-complete', c: 3, label: 'covered', reason: 'Checks the badge is not on the page after Finish.' },
  { feature: 'checkout-complete', c: 4, label: 'covered', reason: 'Clicks Back Home and checks the products page address.' },

  { feature: 'checkout-info', c: 1, label: 'covered', reason: 'Clicks Checkout from the cart and checks the step title.' },
  { feature: 'checkout-info', c: 2, label: 'covered', reason: 'Continues with an empty form and checks the exact first-name error.' },
  { feature: 'checkout-info', c: 3, label: 'covered', reason: 'Fills only the first name and checks the exact last-name error.' },
  { feature: 'checkout-info', c: 4, label: 'covered', reason: 'Fills both names and checks the exact postal-code error.' },
  { feature: 'checkout-info', c: 5, label: 'covered', reason: 'Fills all three fields and checks the overview title.' },
  { feature: 'checkout-info', c: 6, label: 'covered', reason: 'Clicks Cancel and checks the cart address.' },

  { feature: 'checkout-overview', c: 1, label: 'covered', reason: 'With only the Backpack in the cart, checks the overview lists exactly that item.' },
  { feature: 'checkout-overview', c: 2, label: 'covered', reason: 'Checks the item total text exactly.' },
  { feature: 'checkout-overview', c: 3, label: 'covered', reason: 'Checks the tax text exactly.' },
  { feature: 'checkout-overview', c: 4, label: 'covered', reason: 'Checks the total text exactly.' },
  { feature: 'checkout-overview', c: 5, label: 'covered', reason: 'Clicks Cancel and checks the products page address.' },

  { feature: 'inventory-sort', c: 1, label: 'covered', reason: 'Checks the sort box reads az and the first product is the Backpack.' },
  { feature: 'inventory-sort', c: 2, label: 'covered', reason: 'Sorts Z to A and checks the first product name.' },
  { feature: 'inventory-sort', c: 3, label: 'covered', reason: 'Sorts low to high and checks the first name and price.' },
  { feature: 'inventory-sort', c: 4, label: 'covered', reason: 'Sorts high to low and checks the first name and price.' },
  { feature: 'inventory-sort', c: 5, label: 'partial', reason: 'The criterion says after any sort; the test counts 6 after one of the four sorts.' },

  { feature: 'login', c: 1, label: 'covered', reason: 'Logs in as standard_user and checks the products page address.' },
  { feature: 'login', c: 2, label: 'covered', reason: 'Uses a wrong password and checks the error contains the named text.' },
  { feature: 'login', c: 3, label: 'covered', reason: 'Logs in as locked_out_user and checks the error contains the named text.' },
  { feature: 'login', c: 4, label: 'covered', reason: 'Submits an empty form and checks the error contains "Username is required".' },
  {
    feature: 'login', c: 5, label: 'covered', reason: 'Checks the first product is visible, which is what "at least one" asks.',
    borderline: 'Day 35 (RV-21) called this a gap because it passes with one of six products. The weakness is in the criterion, not the test: logged as a criterion gap, not a coverage gap.',
  },

  { feature: 'logout', c: 1, label: 'covered', reason: 'Logs out and checks the address is the login page.' },
  { feature: 'logout', c: 2, label: 'covered', reason: 'Checks the login button is visible after logout.' },
  { feature: 'logout', c: 3, label: 'covered', reason: 'Opens /inventory.html after logout and checks the error contains the named text.' },

  {
    feature: 'product-details', c: 1, label: 'partial', draft: 'covered',
    reason: 'Checks the click goes to inventory-item.html?id=4 but not that the page shows the Backpack; a wrong product or no content at the right address would pass, and this app is known to show the wrong product (Day 35, RV-27). Asserting the name on the page would make it covered.',
    borderline: 'Navigation criteria that name a page type ("returns to the products page") are covered by the address; this one names a specific product\'s page.',
  },
  {
    feature: 'product-details', c: 2, label: 'partial', draft: 'covered',
    reason: 'Compares list and details page for name and price correctly, but only for the first product. The rule applies to every product and this app has known product-mixing bugs, so a wrong price on another product would pass. Looping over all 6 would make it covered.',
    borderline: 'One example is enough unless the other cases could realistically differ; here they could.',
  },
  { feature: 'product-details', c: 3, label: 'covered', reason: 'Adds from the details page with an empty cart and checks the badge reads 1.' },
  { feature: 'product-details', c: 4, label: 'covered', reason: 'Clicks Back to products and checks the products page address.' },

  { feature: 'reset-app-state', c: 1, label: 'covered', reason: 'With two items in the cart, resets and checks the badge is not on the page.' },
  { feature: 'reset-app-state', c: 2, label: 'covered', reason: 'Opens the cart after reset and checks it has no items.' },
  { feature: 'reset-app-state', c: 3, label: 'covered', reason: 'Checks the products page address and its "Products" title after reset.' },
];

export const VARIANTS: Variant[] = [
  // missing: nothing checked relates to the outcome
  {
    key: 'V01', feature: 'login', c: 2, label: 'missing', reason: 'The test has no assertion.',
    find: `    await page.fill('[data-test="password"]', 'wrong_password');
    await page.click('[data-test="login-button"]');

    await expect(page.locator('[data-test="error"]')).toContainText('Username and password do not match');`,
    replace: `    await page.fill('[data-test="password"]', 'wrong_password');
    await page.click('[data-test="login-button"]');`,
  },
  {
    key: 'V02', feature: 'cart', c: 4, label: 'missing', reason: 'Checks the page title, not the badge.',
    find: `    await page.click('[data-test="remove-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);`,
    replace: `    await page.click('[data-test="remove-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="title"]')).toHaveText('Products');`,
  },
  {
    key: 'V03', feature: 'logout', c: 1, label: 'covered', draft: 'missing',
    reason: 'The C1 test\'s /$/ cannot fail, but the C2 test in the same suite checks the login button after logout, which shows the login page. The variant was meant to be missing and was flawed; two Sonnet runs pointed it out.',
    borderline: 'Judged on the whole suite (another test covers it), not on the test written for C1.',
    find: 'await expect(page).toHaveURL(`${BASE_URL}/`);',
    replace: 'await expect(page).toHaveURL(/$/);',
  },
  {
    key: 'V04', feature: 'inventory-sort', c: 5, label: 'missing', reason: 'A count is always at least 0, so the assertion cannot fail.',
    find: `    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(6);`,
    replace: `    const count = await page.locator('[data-test="inventory-item"]').count();
    expect(count).toBeGreaterThanOrEqual(0);`,
  },
  {
    key: 'V05', feature: 'product-details', c: 2, label: 'missing', reason: 'Only the values read from the list are checked; the details page is never read.',
    find: `    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(listName);
    await expect(page.locator('[data-test="inventory-item-price"]')).toHaveText(listPrice);`,
    replace: `    expect(listName).toBeTruthy();
    expect(listPrice).toContain('$');`,
  },
  {
    key: 'V06', feature: 'checkout-info', c: 6, label: 'missing', reason: 'The address is checked before Cancel is clicked, so nothing checks where Cancel goes.',
    find: `    await page.click('[data-test="cancel"]');

    await expect(page).toHaveURL(/cart\\.html/);`,
    replace: `    await expect(page).toHaveURL(/checkout-step-one\\.html/);

    await page.click('[data-test="cancel"]');`,
  },
  {
    key: 'V07', feature: 'checkout-complete', c: 3, label: 'missing', reason: 'The test is skipped, so it never runs.',
    find: `  test('cart badge is cleared after finishing @regression'`,
    replace: `  test.skip('cart badge is cleared after finishing @regression'`,
  },

  // partial: part of the outcome, or some of the cases
  {
    key: 'V08', feature: 'cart', c: 1, label: 'covered', draft: 'partial',
    reason: 'Its own test checks only that a badge appears, but the unchanged C2 test in the same file checks the badge reads 2 after two adds (rule 5).',
    borderline: 'Built to be partial; changed after the rubric-v2 judges pointed out the C2 test.',
    find: `    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');`,
    replace: `    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toBeVisible();`,
  },
  {
    key: 'V09', feature: 'checkout-info', c: 3, label: 'partial', reason: '"required" would also match the first-name and postal-code errors.',
    find: `    await expect(page.locator('[data-test="error"]')).toHaveText('Error: Last Name is required');`,
    replace: `    await expect(page.locator('[data-test="error"]')).toContainText('required');`,
  },
  {
    key: 'V10', feature: 'inventory-sort', c: 3, label: 'partial', reason: 'Checks the first name but not the $7.99 price.',
    find: `    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Onesie');
    await expect(page.locator('[data-test="inventory-item-price"]').first()).toHaveText('$7.99');`,
    replace: `    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Onesie');`,
  },
  {
    key: 'V11', feature: 'logout', c: 3, label: 'partial', reason: 'Checks an error is shown, not its text.',
    find: `    await expect(page.locator('[data-test="error"]')).toContainText(
      "You can only access '/inventory.html' when you are logged in"
    );`,
    replace: `    await expect(page.locator('[data-test="error"]')).toBeVisible();`,
  },
  {
    key: 'V12', feature: 'checkout-overview', c: 4, label: 'partial', reason: 'Checks the total label starts with "Total: $", not the amount.',
    find: `    await expect(page.locator('[data-test="total-label"]')).toHaveText('Total: $32.39');`,
    replace: `    await expect(page.locator('[data-test="total-label"]')).toContainText('Total: $');`,
  },
  {
    key: 'V13', feature: 'cart-persistence', c: 3, label: 'partial', reason: 'Counts two rows but does not check which items they are.',
    find: `    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(['Sauce Labs Backpack', 'Sauce Labs Fleece Jacket']);`,
    replace: `    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveCount(2);`,
  },
  {
    key: 'V14', feature: 'reset-app-state', c: 3, label: 'partial', reason: 'The menu button shows the user is logged in, but it is on every page, so the products page is not checked.',
    find: `    await expect(page).toHaveURL(/inventory\\.html/);
    await expect(page.locator('[data-test="title"]')).toHaveText('Products');`,
    replace: `    await expect(page.locator('#react-burger-menu-btn')).toBeVisible();`,
  },

  // covered: a different style that checks the same thing (V15, V16 below)
  {
    key: 'V15', feature: 'login', c: 4, label: 'covered', reason: 'Finds the full error text by its words instead of by data-test; same outcome.',
    find: `    await expect(page.locator('[data-test="error"]')).toContainText('Username is required');`,
    replace: `    await expect(page.getByText('Epic sadface: Username is required')).toBeVisible();`,
  },
  {
    key: 'V16', feature: 'checkout-complete', c: 1, label: 'covered', reason: 'Checks the page address and the title text by its words; same outcome.',
    find: `  test('finishing shows the Checkout: Complete! page @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Complete!');`,
    replace: `  test('finishing shows the Checkout: Complete! page @smoke', async ({ page }) => {
    await expect(page).toHaveURL(/checkout-complete\\.html/);
    await expect(page.getByText('Checkout: Complete!')).toBeVisible();`,
  },
];

// Round 2: subtler variants, added after all six judges agreed with nearly every
// label in round 1. They get their own case IDs (J60 on), so round 1 is unchanged.
// Labels that depend on how Playwright behaves were checked by running it (1.64.1).
export const HARD: Variant[] = [
  {
    key: 'H01', feature: 'cart', c: 2, label: 'covered',
    reason: 'The expect is not awaited, but Playwright 1.64 fails the test when an assertion is still pending at test end (verified: a wrong value fails with "Test ended." every time). A broken badge is never missed, so covered. The missing await does cost something: when the check has not settled by test end it fails a correct page too (about 1 CI run in 6), a flaky test rather than a weak one.',
    borderline: 'The answer depends on how the test runner behaves, which a reader of the code cannot see; verified at runtime. First recorded as "the right value passes 20 of 20"; CI later showed false failures, so the reason was corrected and the label kept.',
    find: `    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('2');`,
    replace: `    expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('2');`,
  },
  {
    key: 'H02', feature: 'reset-app-state', c: 2, label: 'missing',
    reason: 'data-test="cart-item" does not exist (cart rows are inventory-item), so a count of 0 always passes: run with an item in the cart, it passed.',
    find: `    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(0);`,
    replace: `    await expect(page.locator('[data-test="cart-item"]')).toHaveCount(0);`,
  },
  {
    key: 'H03', feature: 'logout', c: 2, label: 'missing', reason: 'The failure is caught and only logged, so the test passes either way.',
    find: `    await expect(page.locator('[data-test="login-button"]')).toBeVisible();`,
    replace: `    try {
      await expect(page.locator('[data-test="login-button"]')).toBeVisible({ timeout: 2000 });
    } catch {
      console.log('login button not visible yet');
    }`,
  },
  {
    key: 'H04', feature: 'checkout-info', c: 2, label: 'partial',
    reason: 'Needs some error to be shown (not.toHaveText fails when the element is absent), but any error other than the last-name one passes, such as the postal-code error. First drafted as missing; the evidence test showed otherwise.',
    find: `    await expect(page.locator('[data-test="error"]')).toHaveText('Error: First Name is required');`,
    replace: `    await expect(page.locator('[data-test="error"]')).not.toHaveText('Error: Last Name is required');`,
  },
  {
    key: 'H05', feature: 'inventory-sort', c: 4, label: 'missing', reason: 'Selects low to high and checks its last row; the high-to-low option is never chosen.',
    find: `    await page.selectOption('[data-test="product-sort-container"]', 'hilo');

    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Fleece Jacket');
    await expect(page.locator('[data-test="inventory-item-price"]').first()).toHaveText('$49.99');`,
    replace: `    await page.selectOption('[data-test="product-sort-container"]', 'lohi');

    await expect(page.locator('[data-test="inventory-item-name"]').last()).toHaveText('Sauce Labs Fleece Jacket');
    await expect(page.locator('[data-test="inventory-item-price"]').last()).toHaveText('$49.99');`,
  },
  {
    key: 'H06', feature: 'product-details', c: 3, label: 'partial', reason: 'Checks the count only if a badge is already there; a missing badge passes.',
    find: `    await page.click('[data-test="add-to-cart"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');`,
    replace: `    await page.click('[data-test="add-to-cart"]');

    const badge = page.locator('[data-test="shopping-cart-badge"]');
    if (await badge.isVisible()) {
      await expect(badge).toHaveText('1');
    }`,
  },
  {
    key: 'H07', feature: 'checkout-overview', c: 3, label: 'partial', reason: 'The unanchored pattern with an unescaped dot also matches amounts such as $12.48 or $2.45.',
    find: `    await expect(page.locator('[data-test="tax-label"]')).toHaveText('Tax: $2.40');`,
    replace: `    await expect(page.locator('[data-test="tax-label"]')).toHaveText(/2.4/);`,
  },
  {
    key: 'H08', feature: 'cart-persistence', c: 2, label: 'covered', reason: 'Loads the products page again by its address instead of reload(); a full page load either way, and the badge is checked.',
    find: `    await page.reload();`,
    replace: `    await page.goto(\`\${BASE_URL}/inventory.html\`);`,
  },
];
