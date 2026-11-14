# playwright-lint

Repo-wide lint for three kinds of flaky test: a Playwright call that returns a promise and isn't awaited, a count read that doesn't wait, and a state read kept in a variable.

**Overview:** some test steps take a moment to finish. If the test doesn't wait for one, the test can end while the step is still checking the page, or a test can act on what the page looked like a moment ago. Then the result depends on timing: a broken page can slip through, or a correct page can fail. This check finds those missing waits and stale reads before they merge.

---

## Why it exists

The llm-judge-check H01 evidence test failed 4 times in 80 CI runs with "Test ended." Its `expect` was unawaited, and when the check hadn't settled by the end of the test, Playwright failed it even though the page was right.

## The second rule

The multi-user-flow-patterns test "standard user and performance_glitch user can be active at the same time" read `locator.count()` as soon as the URL changed to /inventory. The slow user's list wasn't drawn yet, so it read 0, failed, and passed on the retry. `failOnFlakyTests` turned that into a red CI job. The test now uses `toHaveCount(6)`, and the lint stops a bare `count()` in any spec.

## What it checks

| | |
|---|---|
| Rules | [`eslint-plugin-playwright`](https://github.com/playwright-community/eslint-plugin-playwright) `missing-playwright-await`; in spec files a ban on `locator.count()` (use `expect(locator).toHaveCount(n)`, which waits) and on a state read kept in a variable (`isVisible`, `isHidden`, `isEnabled`, `isDisabled`, `isChecked`, `isEditable`, `textContent`, `innerText`, `innerHTML`, `inputValue`, `getAttribute`, `allTextContents`, `allInnerTexts`) |
| Packages | Every package that depends on Playwright (12), listed in [`eslint.config.mjs`](eslint.config.mjs) |
| Left out | Recorded data that doesn't run as tests: AI-written specs kept as generated, and the judge cases, which are weakened on purpose |
| Allowed | An unawaited call or a stored state read marked with `eslint-disable-next-line ... -- <reason>` (the two H01 evidence tests, and the list values kept in `product-details.spec.js`) |

## Running

```bash
npm run lint:playwright          # from the repo root
cd tools/playwright-lint
npm ci
npm test                         # the lint's own tests
npm run lint
```

**16 tests** (13 lint tests and 3 that run in Chromium):
- A deliberately unawaited fixture ([`fixtures/unawaited.spec.ts`](fixtures/unawaited.spec.ts)) is reported on the right lines.
- The rule is on in every listed package.
- A bare `count()` in a fixture is reported on the right line, and in a spec of every listed package.
- `count()` is allowed outside specs, where a page object may wait first.
- An awaited `expect` passes.
- Every package with a Playwright dependency is in the list, so a new one can't skip the check.
- The config is where the runner looks for it.
- A fixture with three stored state reads is reported on the right lines and the Locator version beneath it is not; the rule is on in a spec of every package, covers all 13 methods, follows a read through a wrapper, a fallback or an assignment, is silent on reads that are not stored (`page.content()`), is off outside specs and can be disabled with a reason.
- In a real browser: a stored `isVisible()` and a stored `textContent()` read the page before an element appears, and the Locator version waits and passes.

Deliberate breaks, all caught: taking the new rule out of the spec block fails 3 lint tests, and putting the two stored reads back in `context-isolation.spec.ts` makes `npm run lint` report 2 findings. Earlier breaks, also caught: removing the reason comment from an H01 evidence line makes `npm run lint` fail, and taking `graphql-test-suite` off the list fails the coverage test.

## The third rule

A Locator is lazy: it finds the element when you act on it or assert on it. Methods like `isVisible()`, `textContent()` and `getAttribute()` return the page as it is at that moment, so a result kept in a variable and used later is the old page. The lint stops a state read assigned to a variable in any spec (`const visible = await el.isVisible()`) and points to `expect(locator).toBeVisible()`, `toHaveText()` and the other assertions that wait. [`test/stale-state.test.mjs`](test/stale-state.test.mjs) shows why in a real browser: a button appears 1.5 seconds after the page loads, the stored read says it is missing, and the Locator version waits and passes.

Before the rule there were 4 stored reads in the suites (2 files). One pair in `context-isolation.spec.ts` read the first product name and then asserted on the variable; it now asserts on the Locator. The pair in `product-details.spec.js` keeps the name and price of the list page to compare with the details page after navigating, so it is allowed with a reason comment. After: 0 findings, 2 allowed with a reason.

Limits: the rule matches the method name, so a page-object method of the same name (`helper.getAttribute()`) is flagged too, and the only way out is the reason comment. It follows a read through up to two wrappers (`Number(await ...)`, `(await ...).trim()`, `(await ...) ?? ''`) and plain assignment; deeper nesting is missed.

It has its own `package.json` because the root uses TypeScript 7, which `typescript-eslint` doesn't support yet.
