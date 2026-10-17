# bdd-playwright-demo

Behaviour-driven tests for the [Sauce Demo](https://www.saucedemo.com) storefront, written in Gherkin and run with Cucumber and Playwright. Product owners can read the feature files; the step definitions drive the browser through page objects.

---

## What It Tests

| Feature file | Scenarios |
|---|---|
| `login.feature` | Valid login `@smoke`, wrong password, locked-out user, empty credentials |
| `inventory.feature` | All products displayed `@smoke`, add to cart updates the badge, multiple items, sorting (a Scenario Outline with 2 examples) |

**9 scenarios, 30 steps** (Cucumber 13 also reports the Before and After hooks as steps, so its summary says 48). Steps, page objects and the browser world are strict TypeScript, run by Node 24 without a build step.

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

In CI, pull requests that don't change this package run `npm run smoke` (2 scenarios); main and the nightly run use `npm test` (all 9). See the root README for the rules.

`smoke` and `regression` first run `scripts/require-scenarios.ts`, which fails if the tag selects no scenarios. `cucumber-js --tags` exits 0 when nothing matches, so without it a mistyped tag (`@smok`) would give a green run that tested nothing. Playwright's `--grep` already fails in that case.

---

## Structure

```
├── features/
│   ├── login.feature
│   ├── inventory.feature
│   └── step_definitions/
├── pageObjects/        # LoginPage, InventoryPage
├── scripts/require-scenarios.ts  # Fails a tagged run that would select nothing
├── support/world.ts    # Browser per scenario, typed as the steps' `this`
└── cucumber.js         # Cucumber config (ESM)
```

---

## Fix Log

- **Config ignored:** `cucumber.js` exported `{ default: {...} }`. In an ESM config the default export already *is* the default profile, so every option was ignored, `support/world.js` never loaded, and every scenario failed with an undefined `page`. The config is now flat and uses `import` for ES modules.
- **Count read too early:** the product count used `locator.count()`, which doesn't wait, so it sometimes counted 0 before the page rendered. It now waits for the first product, then counts.
- **Moved to TypeScript (Day 20):** step functions are typed against the custom World, so a typo like `this.pgae` fails the type-check instead of failing at runtime as `undefined`. The world's `page` throws a clear error if a step runs before the browser opens. An unknown sort value in a feature file now fails with the list of valid options, where before it timed out inside `selectOption`. Cucumber moved from 11 to 13, which supports Node 24.
