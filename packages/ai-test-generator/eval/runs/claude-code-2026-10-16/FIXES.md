# Human fixes: claude-code-2026-10-16

Record what had to change before each spec was usable. Keep entries short and specific.

## feature-product-details

Flagged: 1 of 4 tests failed ("details page shows the same name and price as the list")

- **Cause:** a race between navigation and the assertion. The test clicks a product name, then checks `[data-test="inventory-item-name"]` on the details page. That selector also matches all 6 names on the product list, which is still showing at that moment, so Playwright fails at once with a strict-mode violation (it doesn't wait or retry on an ambiguous locator).
- **First attempt, not enough:** waiting for the details URL (`toHaveURL(/inventory-item\.html/)`) still failed 3 of 3 runs. The site updates the URL before it swaps the page content, so the old list was still in the DOM.
- **Change made:** after the click, wait for an element that only exists on the details page:
  ```js
  await expect(page.locator('[data-test="back-to-products"]')).toBeVisible();
  ```
  Verified: 4 of 4 tests passed on 3 consecutive runs.
- **Lesson for the generator prompt:** after any navigation, wait for an element unique to the new page before asserting on selectors that exist on both pages.

## feature-cart-persistence

Not flagged: all 3 tests passed. Found on 2026-10-19, when an LLM-as-judge check ([llm-judge-check](../../../../llm-judge-check)) asked whether each test really checks its criterion.

- **Cause:** "item stays in the cart after opening another product" clicks a product name and then the cart link straight away. The cart link is on both pages, so nothing waits for the details page. Run 20 times, the details page had not rendered before the cart click in 5: in those runs the test never really opened the details page, so a bug triggered by loading it could pass about 1 run in 4. The test was green every time.
- **Change made:** the same wait as the product-details fix, before opening the cart:
  ```js
  await expect(page.locator('[data-test="back-to-products"]')).toBeVisible();
  ```
  Made in `tests/regression/cart-persistence.spec.js`; the spec in this folder stays unedited.
- **Lesson:** the same as above. A test can be green and still skip the step its criterion depends on; only checking what it exercised, run by run, showed it.
