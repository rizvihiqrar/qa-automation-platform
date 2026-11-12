# Quality Gates

Every gate in one list, from `data/gates.json`. A test reads each file named below and fails when the text that sets the threshold has changed, moved or been copied somewhere the list does not know about.

| Gate | Threshold | Effect | Owner | Set in |
|---|---|---|---|---|
| Dependency audit of the root workspace (npm) | fails on any high or critical advisory | Blocks the job | Iqrar Rizvi | `.github/workflows/ci.yml` |
| Dependency audit of every Node package | fails on a high or critical advisory not triaged in scripts/audit-allowlist.json | Blocks the job | Iqrar Rizvi | `scripts/audit.mjs` |
| Dependency audit of the Python packages (pip-audit) | fails on any known advisory | Blocks the job | Iqrar Rizvi | `.github/workflows/ci.yml` |
| A Playwright test that passes only on a retry | fails the CI job (failOnFlakyTests in every Playwright config; scripts/playwright-config.test.mjs checks them all) | Blocks the job | Iqrar Rizvi | `packages/a11y-aoda-audit/playwright.config.js` |
| Burn-in of changed specs on pull requests | 3 runs with no retries; all 3 must pass | Blocks the job | Iqrar Rizvi | `scripts/burn-in.mjs` |
| OWASP ZAP baseline scan of qa-practice-api (passive rules) | fails on a finding not triaged in packages/qa-practice-api/zap/rules.tsv | Blocks the job | Iqrar Rizvi | `.github/workflows/ci.yml` |
| Mutation score of mutation-testing-demo | reported only: green at 80, amber at 60, no break (break is null) | Reported only | Iqrar Rizvi | `packages/mutation-testing-demo/stryker.config.mjs` |
| A run on main that needed a re-run | a CI health problem for 25 hours, until a merged fix names the run | Reported only | Iqrar Rizvi | `scripts/ci-health.mjs` |
