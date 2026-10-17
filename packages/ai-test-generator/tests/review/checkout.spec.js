// Review findings for the three checkout feature files. See docs/requirement-review.
import { test, expect } from '@playwright/test';
import { PRODUCTS, BASE_URL, defect, loginAndWait, addToCart, openOverview, seedSession, dollars } from './helpers.js';

const [backpack, bikeLight] = PRODUCTS;
const TAX_RATE = 0.08;

async function toInfoStep(page, ...products) {
  await loginAndWait(page);
  await addToCart(page, ...products);
  await page.click('[data-test="shopping-cart-link"]');
  await page.click('[data-test="checkout"]');
  await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Your Information');
}

async function fillAndContinue(page, first, last, postal) {
  await page.fill('[data-test="firstName"]', first);
  await page.fill('[data-test="lastName"]', last);
  await page.fill('[data-test="postalCode"]', postal);
  await page.click('[data-test="continue"]');
}

test.describe('Checkout information: review findings', () => {
  test('RV-06: with every field missing, the first name error comes first @regression', async ({ page }) => {
    await toInfoStep(page, backpack);
    await fillAndContinue(page, '', '', '');
    await expect(page.locator('[data-test="error"]')).toHaveText('Error: First Name is required');
  });

  test('RV-06: with only the postal code filled, the first name error still comes first @regression', async ({ page }) => {
    await toInfoStep(page, backpack);
    await fillAndContinue(page, '', '', 'L1S 2A1');
    await expect(page.locator('[data-test="error"]')).toHaveText('Error: First Name is required');
  });

  // "No first name" is read as "nothing typed"; three spaces are not a name.
  defect('RV-07: a first name of only spaces is rejected', async ({ page }) => {
    await toInfoStep(page, backpack);
    await fillAndContinue(page, '   ', 'Silva', 'L1S 2A1');
    await expect(page.locator('[data-test="error"]')).toHaveText('Error: First Name is required');
  });

  // The story starts "as a customer with an item in my cart"; no criterion covers none.
  defect('RV-09: checkout is blocked when the cart is empty', async ({ page }) => {
    await loginAndWait(page);
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    // The address changes as the click lands (the page content follows a moment
    // later), so the address is what can be checked without waiting.
    await expect(page).toHaveURL(/cart.html/);
  });

  // Cancel goes to the cart from step one but to the products page from step two.
  // Both are written in the criteria; what is not written is that nothing is lost.
  test('RV-10: cancelling on the overview keeps the item in the cart @regression', async ({ page }) => {
    await toInfoStep(page, backpack);
    await fillAndContinue(page, 'Ana', 'Silva', 'L1S 2A1');
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Overview');
    await page.click('[data-test="cancel"]');

    await expect(page.locator('[data-test="title"]')).toHaveText('Products');
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });
});

test.describe('Checkout overview: review findings', () => {
  // The criteria pin $29.99 / $2.40 / $32.39 for one product and never state the
  // rule behind them. Rule: tax is 8% of the item total, rounded to the cent.
  // Read for all 63 non-empty carts of the six products, seeded through the site's
  // own storage so the page loads once per cart instead of walking checkout.
  async function readAllOverviews(page) {
    await seedSession(page);
    const carts = [];
    for (let mask = 1; mask < 1 << PRODUCTS.length; mask++) {
      const chosen = PRODUCTS.filter((_, i) => mask & (1 << i));
      await page.evaluate((ids) => localStorage.setItem('cart-contents', JSON.stringify(ids)), chosen.map((p) => p.id));
      await page.goto(`${BASE_URL}/checkout-step-two.html`);
      await expect(page.locator('[data-test="total-label"]')).toBeVisible();
      carts.push({
        names: chosen.map((p) => p.name),
        cents: chosen.reduce((sum, p) => sum + p.cents, 0),
        subtotal: await page.locator('[data-test="subtotal-label"]').textContent(),
        tax: await page.locator('[data-test="tax-label"]').textContent(),
        total: await page.locator('[data-test="total-label"]').textContent(),
      });
    }
    return carts;
  }

  test('RV-11: tax is 8% to the cent and total is item total plus tax, for all 63 carts @regression', async ({ page }) => {
    test.setTimeout(90000);
    const wrong = (await readAllOverviews(page)).flatMap((c) => {
      const tax = Math.round(c.cents * TAX_RATE);
      const expected = [`Tax: ${dollars(tax)}`, `Total: ${dollars(c.cents + tax)}`];
      const shownSubtotal = Math.round(parseFloat(c.subtotal.replace('Item total: $', '')) * 100);
      return shownSubtotal === c.cents && c.tax === expected[0] && c.total === expected[1]
        ? [] : [{ cart: c.names, expected, shown: [c.subtotal, c.tax, c.total] }];
    });
    expect(wrong).toEqual([]);
  });

  // Amounts held as binary floats and printed without rounding: 6 of the 63 carts
  // read like "Item total: $119.94999999999999".
  defect('RV-13: the item total is written to the cent for all 63 carts', async ({ page }) => {
    test.setTimeout(90000);
    const noisy = (await readAllOverviews(page))
      .filter((c) => c.subtotal !== `Item total: ${dollars(c.cents)}`)
      .map((c) => ({ cart: c.names, shown: c.subtotal }));
    expect(noisy).toEqual([]);
  });

  // The empty-cart overview exists because of RV-09. Its item total drops the cents.
  defect('RV-12: an empty cart\'s item total is written with cents like every other amount', async ({ page }) => {
    await seedSession(page, []);
    await page.goto(`${BASE_URL}/checkout-step-two.html`);
    await expect(page.locator('[data-test="subtotal-label"]')).toHaveText('Item total: $0.00');
  });
});

test.describe('Checkout complete: review findings', () => {
  test('RV-04: after finishing, the cart page is empty and the product buttons read Add to cart @regression', async ({ page }) => {
    await loginAndWait(page);
    await addToCart(page, backpack, bikeLight);
    await openOverview(page);
    await page.click('[data-test="finish"]');
    await expect(page.locator('[data-test="complete-header"]')).toHaveText('Thank you for your order!');

    await page.click('[data-test="shopping-cart-link"]');
    await expect(page.locator('[data-test="title"]')).toHaveText('Your Cart');
    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(0);

    await page.click('[data-test="continue-shopping"]');
    await expect(page.locator(`[data-test="add-to-cart-${backpack.slug}"]`)).toHaveText('Add to cart');
    await expect(page.locator(`[data-test="add-to-cart-${bikeLight.slug}"]`)).toHaveText('Add to cart');
  });

  // Nothing was ordered, yet the confirmation page opens from its address.
  defect('RV-05: the confirmation page is not shown when no order was placed', async ({ page }) => {
    await seedSession(page, [backpack.id]);
    await page.goto(`${BASE_URL}/checkout-complete.html`);
    await expect(page.locator('[data-test="complete-header"]')).toHaveCount(0);
  });
});
