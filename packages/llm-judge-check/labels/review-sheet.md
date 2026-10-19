# Label review

For each case: read the criterion and the test, then the draft label. If you agree, leave `Your label: agree`. If not, replace `agree` with `covered`, `partial` or `missing` (a short reason after it is welcome, e.g. `partial: names only`).

- **covered**: the test does the action and asserts the outcome the criterion names. One example is enough when the criterion describes one.
- **partial**: it asserts only part of that outcome, or only some of the cases the criterion names.
- **missing**: no test that runs asserts it, or the only assertion would pass whether or not it happened.

"Variant" cases are the same spec with one test changed on purpose. Judge only what the code checks.

## cart

### J29 · C1

**Criterion:** Adding a product increments the cart badge count by 1

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('adding a product sets the cart badge to 1 @smoke', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });
```

**Draft:** covered. Adds a product to an empty cart and checks the badge reads 1.

**Borderline:** Only the step from 0 to 1 is tried, not from 1 to 2.

Your label: agree (revised): first changed to partial (0 to 1 can't tell +1 from set-to-1), then back to covered after the rubric-v2 judges pointed out the C2 test in the same file checks 2 after two adds (rule 5, as on J13).

### J27 · C1 · variant V08

**Criterion:** Adding a product increments the cart badge count by 1

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('adding a product sets the cart badge to 1 @smoke', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toBeVisible();
  });
```

**Draft:** partial. Checks a badge appears, not that it reads 1.

Your label: covered (revised): its own test only checks the badge is visible, but the unchanged C2 test checks 2 after two adds (rule 5). Changed after the rubric-v2 judges pointed it out.

### J38 · C2

**Criterion:** Adding two different products shows a badge count of 2

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('adding two different products shows a badge of 2 @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('2');
  });
```

**Draft:** covered. Adds two different products and checks the badge reads 2.

Your label: agree

### J05 · C3

**Criterion:** Removing a product decrements the badge count

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('removing a product decrements the badge @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('[data-test="remove-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });
```

**Draft:** covered. Goes from 2 items to 1 and checks the badge reads 1.

Your label: agree: 2 to 1 is a real decrement and rules out the realistic bugs; 3 to 2 would remove all doubt.

### J32 · C4

**Criterion:** Removing the last item from the cart hides the cart badge entirely

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('removing the last item hides the badge @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="remove-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });
```

**Draft:** covered. Removes the only item and checks the badge is not on the page.

Your label: agree

### J48 · C4 · variant V02

**Criterion:** Removing the last item from the cart hides the cart badge entirely

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('removing the last item hides the badge @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="remove-sauce-labs-backpack"]');

    await expect(page.locator('[data-test="title"]')).toHaveText('Products');
  });
```

**Draft:** missing. Checks the page title, not the badge.

Your label: agree

### J40 · C5

**Criterion:** The cart page shows the correct items after navigating to it

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('cart page lists the items that were added @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(['Sauce Labs Backpack', 'Sauce Labs Bike Light']);
  });
```

**Draft:** covered. Adds two products, opens the cart and checks it lists exactly those two names.

**Borderline:** Day 35 (RV-02) counted names only as a test gap.

Your label: partial: same as J57, names and order only, no price or quantity. Labelled the same as J57 for consistency.

## cart-persistence

### J11 · C1

**Criterion:** An item added to the cart is still in the cart after opening another product's details page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  });

  test('item stays in the cart after opening another product @smoke', async ({ page }) => {
    await page.click('[data-test="item-0-title-link"]');
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(['Sauce Labs Backpack']);
  });
```

**Draft:** covered. Adds the Backpack, opens another product, then checks the cart lists exactly the Backpack.

Your label: partial: verified at runtime, the details page had not rendered before the cart click in 5 of 20 runs, so a bug triggered by loading the details page would pass about 1 run in 4. Fix: wait for the Back button first (as in FIXES.md).

### J34 · C2

**Criterion:** An item added to the cart is still counted in the badge after reloading the products page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  });

  test('badge still counts the item after reloading @regression', async ({ page }) => {
    await page.reload();

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });
```

**Draft:** covered. Reloads the products page and checks the badge reads 1.

Your label: agree

### J57 · C3

**Criterion:** Items in the cart page match the items that were added

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  });

  test('cart page matches the items that were added @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-fleece-jacket"]');
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(['Sauce Labs Backpack', 'Sauce Labs Fleece Jacket']);
  });
```

**Draft:** covered. Adds two items and checks the cart lists exactly those two names, in order.

**Borderline:** Day 35 (RV-02) counted names only as a test gap: price and quantity are not compared.

Your label: partial: checks exact names and order (catches missing, extra and wrong items) but not price or quantity; a cart with the right names and wrong prices would pass. Matches Day 35's names-only gap.

### J52 · C3 · variant V13

**Criterion:** Items in the cart page match the items that were added

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  });

  test('cart page matches the items that were added @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-fleece-jacket"]');
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveCount(2);
  });
```

**Draft:** partial. Counts two rows but does not check which items they are.

Your label: agree

## checkout-complete

### J39 · C1

**Criterion:** Clicking Finish on the overview shows the "Checkout: Complete!" page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');
  });

  test('finishing shows the Checkout: Complete! page @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Complete!');
  });
```

**Draft:** covered. Clicks Finish and checks the title reads "Checkout: Complete!".

Your label: agree

### J26 · C1 · variant V16

**Criterion:** Clicking Finish on the overview shows the "Checkout: Complete!" page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');
  });

  test('finishing shows the Checkout: Complete! page @smoke', async ({ page }) => {
    await expect(page).toHaveURL(/checkout-complete\.html/);
    await expect(page.getByText('Checkout: Complete!')).toBeVisible();
  });
```

**Draft:** covered. Checks the page address and the title text by its words; same outcome.

Your label: agree

### J59 · C2

**Criterion:** The page shows the heading "Thank you for your order!"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');
  });

  test('thank-you heading is shown @regression', async ({ page }) => {
    await expect(page.locator('[data-test="complete-header"]')).toHaveText('Thank you for your order!');
  });
```

**Draft:** covered. Checks the heading text exactly.

Your label: agree

### J04 · C3

**Criterion:** After finishing, the cart badge is no longer shown

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');
  });

  test('cart badge is cleared after finishing @regression', async ({ page }) => {
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });
```

**Draft:** covered. Checks the badge is not on the page after Finish.

Your label: agree

### J14 · C3 · variant V07

**Criterion:** After finishing, the cart badge is no longer shown

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');
  });

  test.skip('cart badge is cleared after finishing @regression', async ({ page }) => {
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });
```

**Draft:** missing. The test is skipped, so it never runs.

Your label: agree

### J42 · C4

**Criterion:** Clicking "Back Home" returns to the products page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');
  });

  test('back home returns to the products page @regression', async ({ page }) => {
    await page.click('[data-test="back-to-products"]');

    await expect(page).toHaveURL(/inventory\.html/);
  });
```

**Draft:** covered. Clicks Back Home and checks the products page address.

Your label: agree: the criterion names a page type and the address identifies it; unlike J07, no realistic right-address/wrong-content bug.

## checkout-info

### J46 · C1

**Criterion:** From the cart, clicking Checkout opens the "Checkout: Your Information" step

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('checkout opens the Your Information step @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Your Information');
  });
```

**Draft:** covered. Clicks Checkout from the cart and checks the step title.

Your label: agree

### J21 · C2

**Criterion:** Continuing with no first name shows "Error: First Name is required"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('missing first name shows an error @regression', async ({ page }) => {
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="error"]')).toHaveText('Error: First Name is required');
  });
```

**Draft:** covered. Continues with an empty form and checks the exact first-name error.

Your label: agree

### J15 · C3

**Criterion:** Continuing with a first name but no last name shows "Error: Last Name is required"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('missing last name shows an error @regression', async ({ page }) => {
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="error"]')).toHaveText('Error: Last Name is required');
  });
```

**Draft:** covered. Fills only the first name and checks the exact last-name error.

Your label: agree

### J56 · C3 · variant V09

**Criterion:** Continuing with a first name but no last name shows "Error: Last Name is required"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('missing last name shows an error @regression', async ({ page }) => {
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="error"]')).toContainText('required');
  });
```

**Draft:** partial. "required" would also match the first-name and postal-code errors.

Your label: agree

### J36 · C4

**Criterion:** Continuing with first and last name but no postal code shows "Error: Postal Code is required"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('missing postal code shows an error @regression', async ({ page }) => {
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="error"]')).toHaveText('Error: Postal Code is required');
  });
```

**Draft:** covered. Fills both names and checks the exact postal-code error.

Your label: agree

### J33 · C5

**Criterion:** Continuing with all three fields filled opens the "Checkout: Overview" step

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('all fields filled continues to the overview @regression', async ({ page }) => {
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="title"]')).toHaveText('Checkout: Overview');
  });
```

**Draft:** covered. Fills all three fields and checks the overview title.

Your label: agree

### J37 · C6

**Criterion:** Clicking Cancel returns to the cart page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('cancel returns to the cart @regression', async ({ page }) => {
    await page.click('[data-test="cancel"]');

    await expect(page).toHaveURL(/cart\.html/);
  });
```

**Draft:** covered. Clicks Cancel and checks the cart address.

Your label: agree: the criterion names a page type and the address identifies it; unlike J07, no realistic right-address/wrong-content bug.

### J01 · C6 · variant V06

**Criterion:** Clicking Cancel returns to the cart page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('cancel returns to the cart @regression', async ({ page }) => {
    await expect(page).toHaveURL(/checkout-step-one\.html/);

    await page.click('[data-test="cancel"]');
  });
```

**Draft:** missing. The address is checked before Cancel is clicked, so nothing checks where Cancel goes.

Your label: agree

## checkout-overview

### J28 · C1

**Criterion:** With only "Sauce Labs Backpack" in the cart, the overview lists that item

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
  });

  test('overview lists the backpack @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(['Sauce Labs Backpack']);
  });
```

**Draft:** covered. With only the Backpack in the cart, checks the overview lists exactly that item.

Your label: agree

### J35 · C2

**Criterion:** The item total reads "Item total: $29.99"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
  });

  test('item total is $29.99 @regression', async ({ page }) => {
    await expect(page.locator('[data-test="subtotal-label"]')).toHaveText('Item total: $29.99');
  });
```

**Draft:** covered. Checks the item total text exactly.

Your label: agree

### J23 · C3

**Criterion:** The tax reads "Tax: $2.40"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
  });

  test('tax is $2.40 @regression', async ({ page }) => {
    await expect(page.locator('[data-test="tax-label"]')).toHaveText('Tax: $2.40');
  });
```

**Draft:** covered. Checks the tax text exactly.

Your label: agree

### J18 · C4

**Criterion:** The total reads "Total: $32.39"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
  });

  test('total is $32.39 @regression', async ({ page }) => {
    await expect(page.locator('[data-test="total-label"]')).toHaveText('Total: $32.39');
  });
```

**Draft:** covered. Checks the total text exactly.

Your label: agree

### J10 · C4 · variant V12

**Criterion:** The total reads "Total: $32.39"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
  });

  test('total is $32.39 @regression', async ({ page }) => {
    await expect(page.locator('[data-test="total-label"]')).toContainText('Total: $');
  });
```

**Draft:** partial. Checks the total label starts with "Total: $", not the amount.

Your label: agree

### J02 · C5

**Criterion:** Clicking Cancel on the overview returns to the products page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
  });

  test('cancel returns to the products page @regression', async ({ page }) => {
    await page.click('[data-test="cancel"]');

    await expect(page).toHaveURL(/inventory\.html/);
  });
```

**Draft:** covered. Clicks Cancel and checks the products page address.

Your label: agree: the criterion names a page type and the address identifies it; unlike J07, no realistic right-address/wrong-content bug.

## inventory-sort

### J44 · C1

**Criterion:** The default sort is Name (A to Z), and the first product is "Sauce Labs Backpack"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('default sort is name A to Z with Sauce Labs Backpack first @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="product-sort-container"]')).toHaveValue('az');
    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Backpack');
  });
```

**Draft:** covered. Checks the sort box reads az and the first product is the Backpack.

Your label: agree: the criterion names what is first and the test checks exactly that (as J53); a first-row-only sort is a criterion gap (RV-15), logged separately.

### J41 · C2

**Criterion:** Sorting by Name (Z to A) shows "Test.allTheThings() T-Shirt (Red)" first

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('name Z to A shows the red T-shirt first @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'za');

    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Test.allTheThings() T-Shirt (Red)');
  });
```

**Draft:** covered. Sorts Z to A and checks the first product name.

Your label: agree: the criterion names what is first and the test checks exactly that (as J53); a first-row-only sort is a criterion gap (RV-15), logged separately.

### J20 · C3

**Criterion:** Sorting by Price (low to high) shows "Sauce Labs Onesie" first, priced $7.99

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('price low to high shows the Onesie first at $7.99 @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'lohi');

    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Onesie');
    await expect(page.locator('[data-test="inventory-item-price"]').first()).toHaveText('$7.99');
  });
```

**Draft:** covered. Sorts low to high and checks the first name and price.

Your label: agree: the criterion names what is first and the test checks exactly that (as J53); a first-row-only sort is a criterion gap (RV-15), logged separately.

### J22 · C3 · variant V10

**Criterion:** Sorting by Price (low to high) shows "Sauce Labs Onesie" first, priced $7.99

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('price low to high shows the Onesie first at $7.99 @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'lohi');

    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Onesie');
  });
```

**Draft:** partial. Checks the first name but not the $7.99 price.

Your label: agree

### J55 · C4

**Criterion:** Sorting by Price (high to low) shows "Sauce Labs Fleece Jacket" first, priced $49.99

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('price high to low shows the Fleece Jacket first at $49.99 @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'hilo');

    await expect(page.locator('[data-test="inventory-item-name"]').first()).toHaveText('Sauce Labs Fleece Jacket');
    await expect(page.locator('[data-test="inventory-item-price"]').first()).toHaveText('$49.99');
  });
```

**Draft:** covered. Sorts high to low and checks the first name and price.

Your label: agree: the criterion names what is first and the test checks exactly that (as J53); a first-row-only sort is a criterion gap (RV-15), logged separately.

### J16 · C5

**Criterion:** The page shows 6 products after any sort

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('six products are shown after sorting @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'hilo');

    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(6);
  });
```

**Draft:** partial. The criterion says after any sort; the test counts 6 after one of the four sorts.

Your label: agree: 'any' names four sorts that could realistically differ; one is tried.

### J19 · C5 · variant V04

**Criterion:** The page shows 6 products after any sort

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('six products are shown after sorting @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'hilo');

    const count = await page.locator('[data-test="inventory-item"]').count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
```

**Draft:** missing. A count is always at least 0, so the assertion cannot fail.

Your label: agree

## login

### J12 · C1

**Criterion:** Logging in with valid credentials redirects to the products page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('valid credentials redirect to the products page @smoke', async ({ page }) => {
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    await expect(page).toHaveURL(/inventory\.html/);
  });
```

**Draft:** covered. Logs in as standard_user and checks the products page address.

Your label: agree: the criterion names a page type and the address identifies it; unlike J07, no realistic right-address/wrong-content bug.

### J49 · C2

**Criterion:** Logging in with an incorrect password shows an error message containing "Username and password do not match"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('incorrect password shows a credential mismatch error @regression', async ({ page }) => {
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'wrong_password');
    await page.click('[data-test="login-button"]');

    await expect(page.locator('[data-test="error"]')).toContainText('Username and password do not match');
  });
```

**Draft:** covered. Uses a wrong password and checks the error contains the named text.

Your label: agree

### J47 · C2 · variant V01

**Criterion:** Logging in with an incorrect password shows an error message containing "Username and password do not match"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('incorrect password shows a credential mismatch error @regression', async ({ page }) => {
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'wrong_password');
    await page.click('[data-test="login-button"]');
  });
```

**Draft:** missing. The test has no assertion.

Your label: agree

### J30 · C3

**Criterion:** Logging in as a locked-out user shows a message containing "Sorry, this user has been locked out"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('locked-out user sees a locked-out message @regression', async ({ page }) => {
    await page.fill('[data-test="username"]', 'locked_out_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    await expect(page.locator('[data-test="error"]')).toContainText('Sorry, this user has been locked out');
  });
```

**Draft:** covered. Logs in as locked_out_user and checks the error contains the named text.

Your label: agree

### J17 · C4

**Criterion:** Submitting the login form without entering any credentials shows "Username is required"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('submitting an empty form shows username required @regression', async ({ page }) => {
    await page.click('[data-test="login-button"]');

    await expect(page.locator('[data-test="error"]')).toContainText('Username is required');
  });
```

**Draft:** covered. Submits an empty form and checks the error contains "Username is required".

Your label: agree

### J24 · C4 · variant V15

**Criterion:** Submitting the login form without entering any credentials shows "Username is required"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('submitting an empty form shows username required @regression', async ({ page }) => {
    await page.click('[data-test="login-button"]');

    await expect(page.getByText('Epic sadface: Username is required')).toBeVisible();
  });
```

**Draft:** covered. Finds the full error text by its words instead of by data-test; same outcome.

Your label: agree

### J53 · C5

**Criterion:** The products page should display at least one product after successful login

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('products page displays at least one product after login @regression', async ({ page }) => {
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    await expect(page.locator('[data-test="inventory-item"]').first()).toBeVisible();
  });
```

**Draft:** covered. Checks the first product is visible, which is what "at least one" asks.

**Borderline:** Day 35 (RV-21) called this a gap because it passes with one of six products; the weakness is in the criterion.

Your label: agree: the criterion asks for at least one product and the test checks that. Day 35's concern (1 of 6 would pass) is a weak criterion, not a coverage gap; logged separately.

## logout

### J31 · C1

**Criterion:** Opening the menu and clicking Logout returns to the login page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="logout-sidebar-link"]');
  });

  test('logout returns to the login page @smoke', async ({ page }) => {
    await expect(page).toHaveURL(`${BASE_URL}/`);
  });
```

**Draft:** covered. Logs out and checks the address is the login page.

Your label: agree: the criterion names a page type and the address identifies it; unlike J07, no realistic right-address/wrong-content bug.

### J13 · C1 · variant V03

**Criterion:** Opening the menu and clicking Logout returns to the login page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="logout-sidebar-link"]');
  });

  test('logout returns to the login page @smoke', async ({ page }) => {
    await expect(page).toHaveURL(/$/);
  });
```

**Draft:** missing. The pattern /$/ matches every address, so the assertion cannot fail.

Your label: covered (ambiguous): the C1 test's /$/ can't fail, but the C2 test in the same suite checks the login button after logout, which shows the login page. The variant was flawed; two Sonnet runs pointed it out.

### J43 · C2

**Criterion:** After logging out, the login button is visible again

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="logout-sidebar-link"]');
  });

  test('login button is visible again after logout @regression', async ({ page }) => {
    await expect(page.locator('[data-test="login-button"]')).toBeVisible();
  });
```

**Draft:** covered. Checks the login button is visible after logout.

Your label: agree

### J03 · C3

**Criterion:** After logging out, going directly to /inventory.html shows an error containing "You can only access '/inventory.html' when you are logged in"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="logout-sidebar-link"]');
  });

  test('inventory is blocked after logout @regression', async ({ page }) => {
    await page.goto(`${BASE_URL}/inventory.html`);

    await expect(page.locator('[data-test="error"]')).toContainText(
      "You can only access '/inventory.html' when you are logged in"
    );
  });
```

**Draft:** covered. Opens /inventory.html after logout and checks the error contains the named text.

Your label: agree

### J09 · C3 · variant V11

**Criterion:** After logging out, going directly to /inventory.html shows an error containing "You can only access '/inventory.html' when you are logged in"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="logout-sidebar-link"]');
  });

  test('inventory is blocked after logout @regression', async ({ page }) => {
    await page.goto(`${BASE_URL}/inventory.html`);

    await expect(page.locator('[data-test="error"]')).toBeVisible();
  });
```

**Draft:** partial. Checks an error is shown, not its text.

Your label: agree

## product-details

### J07 · C1

**Criterion:** Clicking a product's name opens its details page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('clicking a product name opens its details page @smoke', async ({ page }) => {
    await page.click('[data-test="item-4-title-link"]');

    await expect(page).toHaveURL(/inventory-item\.html\?id=4/);
  });
```

**Draft:** covered. Clicks the item-4 name and checks the address is the details page for id 4.

**Borderline:** Only the address is checked, not that the page shows that product (Day 35, RV-27).

Your label: partial: checks the click goes to inventory-item.html?id=4 but not that the page shows the Backpack; a wrong product or no content at the right address would pass. Asserting the product name on the page would make it covered.

### J08 · C2

**Criterion:** The details page shows the same name and price as the product list

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('details page shows the same name and price as the list @regression', async ({ page }) => {
    const listName = await page.locator('[data-test="inventory-item-name"]').first().innerText();
    const listPrice = await page.locator('[data-test="inventory-item-price"]').first().innerText();

    await page.locator('[data-test="inventory-item-name"]').first().click();

    await expect(page.locator('[data-test="inventory-item-name"]')).toHaveText(listName);
    await expect(page.locator('[data-test="inventory-item-price"]')).toHaveText(listPrice);
  });
```

**Draft:** covered. Reads the first product's name and price, opens it, and checks the details page shows both.

**Borderline:** Day 35 (RV-24) counted one product of six as a test gap.

Your label: partial: compares list and details page for name and price correctly, but only for the first product; the rule applies to every product and this app has known product-mixing bugs (Day 35, J07). Looping over all 6 would make it covered.

### J45 · C2 · variant V05

**Criterion:** The details page shows the same name and price as the product list

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('details page shows the same name and price as the list @regression', async ({ page }) => {
    const listName = await page.locator('[data-test="inventory-item-name"]').first().innerText();
    const listPrice = await page.locator('[data-test="inventory-item-price"]').first().innerText();

    await page.locator('[data-test="inventory-item-name"]').first().click();

    expect(listName).toBeTruthy();
    expect(listPrice).toContain('$');
  });
```

**Draft:** missing. Only the values read from the list are checked; the details page is never read.

Your label: agree

### J54 · C3

**Criterion:** Adding the product to the cart from the details page shows a cart badge of 1

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('adding from the details page sets the cart badge to 1 @regression', async ({ page }) => {
    await page.click('[data-test="item-4-title-link"]');
    await page.click('[data-test="add-to-cart"]');

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });
```

**Draft:** covered. Adds from the details page with an empty cart and checks the badge reads 1.

Your label: agree: the criterion names the result 'a badge of 1', which only applies from an empty cart (unlike J29's 'increments by 1').

### J50 · C4

**Criterion:** Clicking "Back to products" returns to the products page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('back to products returns to the products page @regression', async ({ page }) => {
    await page.click('[data-test="item-4-title-link"]');
    await page.click('[data-test="back-to-products"]');

    await expect(page).toHaveURL(/inventory\.html/);
  });
```

**Draft:** covered. Clicks Back to products and checks the products page address.

Your label: agree: the criterion names a page type and the address identifies it; unlike J07, no realistic right-address/wrong-content bug.

## reset-app-state

### J58 · C1

**Criterion:** With items in the cart, choosing "Reset App State" from the menu removes the cart badge

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="reset-sidebar-link"]');
  });

  test('reset removes the cart badge @smoke', async ({ page }) => {
    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveCount(0);
  });
```

**Draft:** covered. With two items in the cart, resets and checks the badge is not on the page.

Your label: agree

### J25 · C2

**Criterion:** After resetting, the cart page shows no items

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="reset-sidebar-link"]');
  });

  test('cart page is empty after reset @regression', async ({ page }) => {
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="inventory-item"]')).toHaveCount(0);
  });
```

**Draft:** covered. Opens the cart after reset and checks it has no items.

Your label: agree

### J06 · C3

**Criterion:** After resetting, the user is still logged in and can see the products page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="reset-sidebar-link"]');
  });

  test('user stays logged in on the products page after reset @regression', async ({ page }) => {
    await expect(page).toHaveURL(/inventory\.html/);
    await expect(page.locator('[data-test="title"]')).toHaveText('Products');
  });
```

**Draft:** covered. Checks the products page address and its "Products" title after reset.

Your label: agree

### J51 · C3 · variant V14

**Criterion:** After resetting, the user is still logged in and can see the products page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="reset-sidebar-link"]');
  });

  test('user stays logged in on the products page after reset @regression', async ({ page }) => {
    await expect(page.locator('#react-burger-menu-btn')).toBeVisible();
  });
```

**Draft:** partial. The menu button shows the user is logged in, but it is on every page, so the products page is not checked.

Your label: agree

## Round 2: subtler variants (added later)

*Feature: cart*

### J62 · C2 · variant H01

**Criterion:** Adding two different products shows a badge count of 2

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('adding two different products shows a badge of 2 @regression', async ({ page }) => {
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');

    expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('2');
  });
```

**Draft:** covered. The expect is not awaited, but Playwright still fails the test if it has not passed when the test ends ("Test ended."): run with a wrong value, it failed.

Your label: agree (ambiguous): no await, but Playwright 1.64 fails the test when an assertion is still pending at test end (verified: '3' fails with 'Test ended.', '2' passes 20/20). Enforced, so covered; style issue: add await. Judges unanimously said missing.

*Feature: cart-persistence*

### J66 · C2 · variant H08

**Criterion:** An item added to the cart is still counted in the badge after reloading the products page

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  });

  test('badge still counts the item after reloading @regression', async ({ page }) => {
    await page.goto(`${BASE_URL}/inventory.html`);

    await expect(page.locator('[data-test="shopping-cart-badge"]')).toHaveText('1');
  });
```

**Draft:** covered. Loads the products page again by its address instead of reload(); a full page load either way, and the badge is checked.

Your label: agree

*Feature: checkout-info*

### J65 · C2 · variant H04

**Criterion:** Continuing with no first name shows "Error: First Name is required"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
  });

  test('missing first name shows an error @regression', async ({ page }) => {
    await page.click('[data-test="continue"]');

    await expect(page.locator('[data-test="error"]')).not.toHaveText('Error: Last Name is required');
  });
```

**Draft:** partial. Needs some error to be shown (not.toHaveText fails when the element is absent), but any error other than the last-name one passes, such as the postal-code error. (Changed from missing after the evidence test, see evidence/label-evidence.spec.ts.)

Your label: agree

*Feature: checkout-overview*

### J60 · C3 · variant H07

**Criterion:** The tax reads "Tax: $2.40"

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'Ana');
    await page.fill('[data-test="lastName"]', 'Silva');
    await page.fill('[data-test="postalCode"]', 'L1S 2A1');
    await page.click('[data-test="continue"]');
  });

  test('tax is $2.40 @regression', async ({ page }) => {
    await expect(page.locator('[data-test="tax-label"]')).toHaveText(/2.4/);
  });
```

**Draft:** partial. The unanchored pattern with an unescaped dot also matches amounts such as $12.48 or $2.45.

Your label: agree

*Feature: inventory-sort*

### J67 · C4 · variant H05

**Criterion:** Sorting by Price (high to low) shows "Sauce Labs Fleece Jacket" first, priced $49.99

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('price high to low shows the Fleece Jacket first at $49.99 @regression', async ({ page }) => {
    await page.selectOption('[data-test="product-sort-container"]', 'lohi');

    await expect(page.locator('[data-test="inventory-item-name"]').last()).toHaveText('Sauce Labs Fleece Jacket');
    await expect(page.locator('[data-test="inventory-item-price"]').last()).toHaveText('$49.99');
  });
```

**Draft:** missing. Selects low to high and checks its last row; the high-to-low option is never chosen.

Your label: agree

*Feature: logout*

### J61 · C2 · variant H03

**Criterion:** After logging out, the login button is visible again

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="logout-sidebar-link"]');
  });

  test('login button is visible again after logout @regression', async ({ page }) => {
    try {
      await expect(page.locator('[data-test="login-button"]')).toBeVisible({ timeout: 2000 });
    } catch {
      console.log('login button not visible yet');
    }
  });
```

**Draft:** missing. The failure is caught and only logged, so the test passes either way.

Your label: agree

*Feature: product-details*

### J64 · C3 · variant H06

**Criterion:** Adding the product to the cart from the details page shows a cart badge of 1

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
  });

  test('adding from the details page sets the cart badge to 1 @regression', async ({ page }) => {
    await page.click('[data-test="item-4-title-link"]');
    await page.click('[data-test="add-to-cart"]');

    const badge = page.locator('[data-test="shopping-cart-badge"]');
    if (await badge.isVisible()) {
      await expect(badge).toHaveText('1');
    }
  });
```

**Draft:** partial. Checks the count only if a badge is already there; a missing badge passes.

Your label: agree: badge only checked when visible; a wrong count fails but a missing badge (add to cart failed) passes. Catches part of the criterion but misses the main failure. Fix: assert visible, then text.

*Feature: reset-app-state*

### J63 · C2 · variant H02

**Criterion:** After resetting, the cart page shows no items

```js
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="add-to-cart-sauce-labs-bike-light"]');
    await page.click('#react-burger-menu-btn');
    await page.click('[data-test="reset-sidebar-link"]');
  });

  test('cart page is empty after reset @regression', async ({ page }) => {
    await page.click('[data-test="shopping-cart-link"]');

    await expect(page.locator('[data-test="cart-item"]')).toHaveCount(0);
  });
```

**Draft:** missing. data-test="cart-item" does not exist (cart rows are inventory-item), so a count of 0 always passes: run with an item in the cart, it passed.

Your label: agree
