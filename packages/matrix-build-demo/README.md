# Matrix Build Demo

A JavaScript utility library demonstrating **matrix CI builds** — the same test suite run against multiple Node.js versions and operating systems simultaneously. The pipeline configuration is the main subject; the library provides a real test suite to run.

**In plain English:** People run software on different versions and operating systems. This runs the same tests on several combinations at once, so a problem that only happens on one setup is still caught.

## What Matrix Builds Do

A standard pipeline runs tests once. A matrix pipeline fans out to run the same tests in every combination of versions and environments in parallel:

```
Node 18 / ubuntu ─┐
Node 18 / macOS  ─┤
Node 18 / windows─┤
Node 20 / ubuntu ─┼── all run concurrently ──► merge results
Node 20 / macOS  ─┤
Node 20 / windows─┤
Node 22 / ubuntu ─┤
Node 22 / macOS  ─┤
Node 22 / windows─┘
```

**Why it matters for QA:** A bug that only surfaces on Node 18 + Windows is invisible if you only test on Node 20 + Ubuntu. Matrix builds catch cross-environment regressions before they reach users.

## Three-Platform Comparison

| Platform | Config file | Matrix syntax |
|---|---|---|
| **GitHub Actions** | `.github/workflows/ci.yml` | `strategy.matrix` with `fail-fast: false` |
| **GitLab CI** | `.gitlab-ci.yml` | YAML anchors (`&test_template`) + one job per version |
| **Azure DevOps** | `azure-pipelines.yml` | `strategy.matrix` + `maxParallel` + `PublishTestResults` per cell |

### Key syntax differences

```yaml
# GitHub Actions — declare version list, matrix expands automatically
strategy:
  fail-fast: false
  matrix:
    node-version: [18, 20, 22]
    os: [ubuntu-latest, macos-latest, windows-latest]

# GitLab CI — explicit job per version using YAML anchors (no native matrix in free tier)
.test_template: &test_definition
  image: node:${NODE_VERSION}-alpine
  script: [npm ci, npm test]

test:node20:
  <<: *test_definition
  variables:
    NODE_VERSION: '20'

# Azure DevOps — named matrix entries; variable injected as $(nodeVersion)
strategy:
  matrix:
    Node18:
      nodeVersion: '18.x'
    Node20:
      nodeVersion: '20.x'
  maxParallel: 3
```

### fail-fast behaviour

| Platform | Default | Override |
|---|---|---|
| GitHub Actions | `fail-fast: true` (stop all cells on first failure) | `fail-fast: false` |
| GitLab CI | jobs are independent — no fail-fast | n/a |
| Azure DevOps | all cells complete unless a job dependency fails | `continueOnError: true` per job |

Setting `fail-fast: false` in GitHub Actions is deliberate here — when debugging a cross-version regression you want to see *every* failing cell, not just the first.

## Utility Library

Three modules of pure functions — no I/O, no side-effects, easy to test in any Node version:

| Module | Functions |
|---|---|
| `src/stringUtils.js` | `truncate`, `titleCase`, `slugify`, `countWords`, `isPalindrome` |
| `src/numberUtils.js` | `clamp`, `roundTo`, `isEven`, `sumArray`, `average` |
| `src/validators.js` | `isEmail`, `isUrl`, `isPostalCode` (CA/US/UK), `isPhoneNumber` |

## Test Coverage

**99 Jest tests** across three test files:

| File | Tests | What it covers |
|---|---|---|
| `tests/stringUtils.test.js` | 36 | happy path, edge cases (empty string, max length boundary), TypeError / RangeError throws |
| `tests/numberUtils.test.js` | 31 | numeric edge cases (negative range, floating-point rounding, empty array), TypeError / RangeError throws |
| `tests/validators.test.js` | 32 | valid and invalid formats for each locale, non-string input guard |

## Running Locally

```bash
npm install
npm test              # run all tests once
npm run test:coverage # run with coverage report
```

## Project Structure

```
matrix-build-demo/
├── src/
│   ├── stringUtils.js        # String utility functions
│   ├── numberUtils.js        # Numeric utility functions
│   └── validators.js         # Format validators (email, URL, postal code, phone)
├── tests/
│   ├── stringUtils.test.js
│   ├── numberUtils.test.js
│   └── validators.test.js
├── .github/workflows/ci.yml  # GitHub Actions — 9-cell matrix (3 versions × 3 OS)
├── .gitlab-ci.yml            # GitLab CI — YAML anchor pattern, 3 jobs
└── azure-pipelines.yml       # Azure DevOps — matrix strategy + PublishTestResults
```
