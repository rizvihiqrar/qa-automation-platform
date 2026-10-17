<!-- Local run, 2026-10-17: npx playwright test -c playwright.regression.config.js --repeat-each=59 --retries=0 (4 workers, 12.5 min, live Sauce Demo site) -->

## Run-to-run variance: 2537 runs of 43 tests

First-try pass rate across all runs: **100%** (95% CI 99.85%–100%).

### Failed at least once: 0

None.

### Never failed: 43

Each ran at least 59 times without a failure. That only shows each one fails less than **5.0%** of the time (95% confidence), not that it never fails. Ruling out 1 failure in 20 takes 59 clean runs; 1 in 100 takes 299.

### How many runs it takes to catch a flaky test

| Test fails 1 run in | Runs for a 95% chance of seeing it fail | Chance it passes all 14 runs anyway |
|---:|---:|---:|
| 100 | 299 | 86.9% |
| 50 | 149 | 75.4% |
| 20 | 59 | 48.8% |
| 10 | 29 | 22.9% |
| 5 | 14 | 4.4% |

