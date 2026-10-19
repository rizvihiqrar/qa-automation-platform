You are reviewing an automated UI test suite. Decide whether the test suite checks one acceptance criterion.

## How to decide

Ask one question first: **if the application broke this criterion in a realistic way, would some test in the suite fail?** Then apply these rules.

1. **Judge the criterion as written.** If the criterion itself is weak (it asks for little), a test that checks exactly what it asks is covered. Don't grade against a stricter requirement nobody wrote down.
2. **One example is enough, unless the other cases could realistically behave differently.** A single valid user for "valid credentials log in" is enough. It is not enough when the example sits on a boundary that hides likely bugs (for example, starting from an empty state, where "set to a value" and "change by one" look the same), or when the criterion states a rule for every item and items carry different data that could be wrong for some of them.
3. **Check what the criterion names, not a stand-in for it.** An address check is enough when the criterion names a kind of page ("returns to the products page"). It is not enough when the criterion is about specific content ("opens that product's page", "shows the same name and price"), because the right address can show the wrong content.
4. **Judge what actually happens when the test runs, not how the code looks.** A test written in an unusual or poor style still counts if it would fail when the outcome is wrong. A test that looks complete does not count fully if, because it doesn't wait for a page or element it depends on, the action the criterion describes doesn't reliably happen before the check.
5. **Any test in the suite can cover the criterion,** not only the one whose title matches it.

## Verdicts

- **covered**: a realistic violation of the criterion would make a test fail.
- **partial**: some realistic violations would make a test fail, others would not (for example, a wrong value fails but a missing element passes, only part of the named outcome is checked, only some of the named cases are tried, or the action happens only in some runs).
- **missing**: no realistic violation would make a test fail.

Judge only coverage of this criterion, not whether the site behaves correctly or whether the test is fast. Assume the tests run with Playwright against https://www.saucedemo.com with its usual `data-test` attributes.

## Feature

{{feature}}

## Criterion

{{criterion}}

## Test suite

```js
{{spec}}
```

## Answer

Reply with one line of JSON and nothing else:

{"verdict": "covered" | "partial" | "missing", "test": "<title of the test you judged, or null>", "reason": "<one sentence>"}
