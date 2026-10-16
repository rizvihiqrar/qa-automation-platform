# bdd-playwright-demo

Behaviour-driven tests for the [Sauce Demo](https://www.saucedemo.com) storefront, written in Gherkin and run with Cucumber and Playwright. Product owners can read the feature files; the step definitions drive the browser through page objects.

---

## What It Tests

| Feature file | Scenarios |
|---|---|
| `login.feature` | Valid login `@smoke`, wrong password, locked-out user, empty credentials |
| `inventory.feature` | All products displayed `@smoke`, add to cart updates the badge, multiple items, sorting (a Scenario Outline with 2 examples) |

**9 scenarios, 30 steps.**

---

## Running

```bash
npm install
npx playwright install chromium

npm test            # all scenarios
npm run smoke       # @smoke only
npm run regression  # @regression only
```

An HTML report is written to `reports/cucumber-report.html`.

---

## Structure

```
├── features/
│   ├── login.feature
│   ├── inventory.feature
│   └── step_definitions/
├── pageObjects/        # LoginPage, InventoryPage
├── support/world.js    # Browser per scenario
└── cucumber.js         # Cucumber config (ESM)
```

---

## Fix Log

- **Config ignored:** `cucumber.js` exported `{ default: {...} }`. In an ESM config the default export already *is* the default profile, so every option was ignored, `support/world.js` never loaded, and every scenario failed with an undefined `page`. The config is now flat and uses `import` for ES modules.
- **Count read too early:** the product count used `locator.count()`, which doesn't wait, so it sometimes counted 0 before the page rendered. It now waits for the first product, then counts.
