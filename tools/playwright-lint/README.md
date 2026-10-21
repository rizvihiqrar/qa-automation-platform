# playwright-lint

Repo-wide lint for one kind of flaky test: a Playwright call that returns a promise and isn't awaited.

**In plain English:** some test steps take a moment to finish. If the test doesn't wait for one, the test can end while the step is still checking the page. Then the result depends on timing: a broken page can slip through, or a correct page can fail. This check finds those missing waits before they merge.

---

## Why it exists

The llm-judge-check H01 evidence test failed 4 times in 80 CI runs with "Test ended." Its `expect` was unawaited, and when the check hadn't settled by the end of the test, Playwright failed it even though the page was right.

## What it checks

| | |
|---|---|
| Rule | [`eslint-plugin-playwright`](https://github.com/playwright-community/eslint-plugin-playwright) `missing-playwright-await` |
| Packages | Every package that depends on Playwright (8), listed in [`eslint.config.mjs`](eslint.config.mjs) |
| Left out | Recorded data that doesn't run as tests: AI-written specs kept as generated, and the judge cases, which are weakened on purpose |
| Allowed | An unawaited call marked with `eslint-disable-next-line ... -- <reason>` (the two H01 evidence tests) |

## Running

```bash
npm run lint:playwright          # from the repo root
cd tools/playwright-lint
npm ci
npm test                         # the lint's own tests
npm run lint
```

**5 tests:**
- A deliberately unawaited fixture ([`fixtures/unawaited.spec.ts`](fixtures/unawaited.spec.ts)) is reported on the right lines.
- The rule is on in every listed package.
- An awaited `expect` passes.
- Every package with a Playwright dependency is in the list, so a new one can't skip the check.
- The config is where the runner looks for it.

Deliberate breaks, both caught: removing the reason comment from an H01 evidence line makes `npm run lint` fail, and taking `graphql-test-suite` off the list fails the coverage test.

It has its own `package.json` because the root uses TypeScript 7, which `typescript-eslint` doesn't support yet.
