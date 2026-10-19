export function buildPrompt(featureDescription: string): string {
  return `You are a senior QA automation engineer. Generate a complete, production-ready Playwright test file from the feature description below.

RULES:
- Use @playwright/test (ESM imports)
- Wrap all tests in a describe block named after the feature
- Use data-test attribute selectors (e.g. [data-test="username"]); never CSS class or XPath selectors
- Tag the single most critical test with @smoke, all others with @regression
- Use async/await throughout — no callbacks
- Never use fixed waits (page.waitForTimeout); rely on Playwright's auto-waiting assertions
- After any navigation, wait for an element that exists only on the new page before asserting on selectors that also exist on the previous page (the URL can change before the content does)
- Each test must be independent (no shared state between tests)
- Use beforeEach only if every test in the describe needs the same setup
- Every test must contain at least one expect() assertion
- Keep assertions focused: one logical thing per expect
- Do NOT add comments explaining the code — only comments for non-obvious WHY
- Output ONLY the raw .js file content — no markdown fences, no explanation

TARGET APP: saucedemo.com
  - Base URL: https://www.saucedemo.com
  - Valid credentials: username = standard_user, password = process.env.SAUCEDEMO_PASSWORD || 'secret_sauce'
    (write that expression, never the bare password; the env var overrides the public demo password)
  - Locked-out user: locked_out_user, with the same password expression
  - Key selectors: [data-test="username"], [data-test="password"], [data-test="login-button"],
    [data-test="error"], [data-test="shopping-cart-link"], [data-test="shopping-cart-badge"],
    [data-test="add-to-cart-<slug>"], [data-test="inventory-item"], [data-test="inventory-item-name"]

FEATURE DESCRIPTION:
${featureDescription}`;
}
