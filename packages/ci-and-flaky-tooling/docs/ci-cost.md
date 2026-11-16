# CI cost audit

The 142 CI runs of rizvihiqrar/qa-automation-platform created from 2026-11-02 to 2026-11-16 (UTC dates; 82 on pull requests, 60 on main, nightly or manual). Job timings are the real start and end times GitHub recorded, every attempt of a re-run included. A job that was skipped, or that has no recorded run time, is not counted; a cancelled job counts for the time it ran. All the jobs run on `ubuntu-latest`, so no runner multiplier applies (Windows and macOS minutes would count double or more). This repository is public, so the runs are free: the numbers are minutes, and the price is whatever rate you apply.

## The totals

| | Minutes |
|---|---:|
| Time the jobs actually ran | 3,682 |
| Billed (each job rounded up to a whole minute) | 7,523 |
| Billed for time nothing ran in | 3,841.1 (51% of the bill) |
| Billed per run, on average | 53 |

## Where the minutes go, by kind of job

Each job has one kind in [`data/job-tags.json`](../data/job-tags.json); a job with no kind fails the check, so the totals add up to the whole.

| Kind | Jobs | Billed minutes | Share |
|---|---:|---:|---:|
| tools | 15 | 1,942 | 26% |
| browser | 9 | 1,860 | 25% |
| api | 10 | 1,504 | 20% |
| container | 4 | 828 | 11% |
| housekeeping | 5 | 763 | 10% |
| ai | 3 | 626 | 8% |

## The costliest jobs

| Job | Kind | Job runs | Median | Slowest 10% | Billed minutes |
|---|---|---:|---:|---:|---:|
| banking-api-ui | browser | 134 | 145 s | 172 s | 368 |
| regression (shards) | browser | 263 | 37 s | 54 s | 325 |
| langfuse-traces | container | 134 | 116 s | 128 s | 297 |
| typecheck | housekeeping | 133 | 100 s | 125 s | 278 |
| k6-performance | api | 134 | 73 s | 83 s | 255 |
| llm-judge-check | ai | 134 | 66 s | 90 s | 252 |
| ai-test-generator | ai | 134 | 69 s | 96 s | 239 |
| qa-practice-api-postgres | container | 134 | 76 s | 88 s | 239 |

## Savings, measured

**Run the quick jobs as one.** 3 jobs never ran longer than 30 seconds (ci-and-flaky-tooling, regression scope, worker-scaling-benchmark). Billed one by one they cost 323 minutes in this window; run as one job per run they would cost 130. That saves 193 billed minutes (3% of the bill), and the checkout and install each job repeats is on top of that and not counted.

**Move a job that never fails on pull requests to main.** 82 pull request runs billed 4,008 minutes. The 5 costliest jobs that failed on none of them:

| Job | Kind | Job runs on pull requests | Billed minutes | Failed on a pull request |
|---|---|---:|---:|---:|
| banking-api-ui | browser | 72 | 188 | 0 |
| langfuse-traces | container | 72 | 152 | 0 |
| playwright lint | housekeeping | 72 | 85 | 0 |
| matrix-build-demo | tools | 72 | 81 | 0 |
| burn-in | housekeeping | 72 | 80 | 0 |

Moving all 5 to main would save 586 minutes (15% of the pull request minutes). That is where to look, not a decision: a job that never failed in 82 runs may be the one that catches the next bug, and `scripts/test-scope.mjs` already skips the packages a pull request does not touch.
