# mutation-testing-demo

Mutation testing with [Stryker](https://stryker-mutator.io/) applied to a shopping cart module. The goal is to show that **code coverage alone is a weak quality signal** — mutation score reveals whether your tests actually verify the logic, not just execute it.

**In plain English:** A test that runs code isn't necessarily checking it. This plants small bugs in the code on purpose and checks whether the tests notice; here they catch 89% of them.

## Mutation Score

| File | Mutants | Killed | Survived | Score |
|---|---|---|---|---|
| `src/cart.js` | 130 | 118 | 12 | **90.8%** |
| `src/validators.js` | 92 | 80 | 12 | **87.0%** |
| **Total** | **222** | **198** | **24** | **89.2%** |

The suite scores above the **80% high threshold** defined in `stryker.config.mjs`.

## What Mutation Testing Is

Stryker injects small code changes ("mutants") into the source — flipping `<` to `<=`, changing `||` to `&&`, replacing a string literal with an empty string — then runs the test suite. If no test fails, the mutant **survived** (a gap in your assertions). If any test fails, the mutant was **killed** (the tests caught it).

A test suite with 100% line coverage can still have a mutation score of 40% if it never asserts specific values. Mutation testing surfaces that gap.

## Running Tests

```bash
npm install

# Unit tests with coverage
npm run test:coverage

# Mutation testing (generates reports/mutation/mutation.html)
npm run test:mutation
```

## Surviving Mutants — What They Tell Us

The 24 surviving mutants reveal real assertion gaps. Two examples:

**1. The `name` fallback is untested:**
```js
// src/cart.js — a mutant that survived
// Original:
this._items.push({ ..., name: product.name || '', ... });
// Mutant (survived):
this._items.push({ ..., name: "Stryker was here!", ... });
```
No test asserts `item.name` after adding a product. The fix is one assertion: `expect(cart.getItems()[0].name).toBe('Widget')`.

**2. The `applyDiscount` type guard is partially untested:**
```js
// Original:
if (!code || typeof code !== 'string') { throw ... }
// Mutant (survived — changes || to &&):
if (!code && typeof code !== 'string') { throw ... }
```
No test passes a non-falsy non-string (e.g. `applyDiscount(123)`). The `typeof` check is never isolated from the falsy check.

These are low-risk gaps in this context, but in production financial logic they would matter.

## Project Structure

```
mutation-testing-demo/
├── src/
│   ├── cart.js           Cart class — add, remove, discount, tax, total
│   └── validators.js     Input validators — email, price, quantity, product ID
├── tests/
│   ├── cart.test.js      89 Jest tests (deliberately thorough)
│   └── validators.test.js
├── stryker.config.mjs    Stryker config — 80% threshold, HTML report
└── package.json
```

## Stack

- **[Stryker Mutator](https://stryker-mutator.io/)** — mutation testing framework
- **Jest** — test runner
- **GitHub Actions** — runs unit tests then mutation tests; uploads HTML report as artifact

## Key Insight

> "100% line coverage with a 50% mutation score means your tests run every line but verify almost nothing."

Mutation testing is the next level after coverage: it tells you whether your tests are *honest*.
