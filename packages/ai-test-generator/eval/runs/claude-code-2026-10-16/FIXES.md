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
