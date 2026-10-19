You are reviewing an automated UI test suite. Decide whether the test suite checks one acceptance criterion.

## Rubric

Answer with exactly one verdict:

- **covered**: a test performs the action the criterion describes and asserts the outcome the criterion names. When the criterion describes a single example ("a product", "an item"), one example is enough. A test that reaches the same result by a different route or with a different style of assertion still counts.
- **partial**: a test asserts only part of the named outcome, or covers only some of the cases the criterion names.
- **missing**: no test that runs asserts the named outcome, or the only assertion would pass whether or not the outcome happened.

Judge only what the code checks, not whether the site behaves correctly, whether the test is fast, or whether the criterion itself is well written. Assume the tests run against https://www.saucedemo.com with its usual `data-test` attributes.

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
