# Live tokens in published reports

| | |
|---|---|
| **Where** | [postman-api-collection](../../packages/postman-api-collection) report, published by [ci-dashboard](../../packages/ci-dashboard) |
| **Found by** | A secret scan written before the first publish to GitHub Pages (Day 25) |
| **Impact** | Each Postman report held 19 live access and refresh tokens for DummyJSON's public demo account. Never published to Pages. The raw CI artifact did hold them (7-day retention, downloadable by signed-in GitHub users) until Day 31 |
| **Fixed in** | Publish scan: Day 25 (PR #24). Removed at the source: Day 31 |

## Symptom

The first scan of the reports about to be published flagged 19 JWTs, all in the Postman HTML report. Day 31 broke them down:

| Where in the report | Tokens |
|---|---:|
| `Cookie` and `Set-Cookie` headers (DummyJSON sets the token as a cookie, and Newman sends it back on later requests) | 16 |
| The valid login's response body (`accessToken`, `refreshToken`) | 2 |
| The `Authorization: Bearer` header | 1 |

## How it was found

Publishing test reports makes them public, so Day 25 started from "what in these reports must never be public?" and wrote the scan before the publish step: JWT, bearer, GitHub and Anthropic token patterns, plus Windows user paths. It was run against a real CI run's reports before anything went live.

## Root cause

HTML test reports are built for debugging, so they record everything: every header and body of every request. A login test's response is, by definition, a credential. The reports had only ever been CI artifacts, seen by people who could already read the repo, and publishing them changed who could see them without changing what they held.

**Why it wasn't caught earlier:** no one reads a passing report closely, and the tokens are for a public demo account, so they didn't look like secrets.

## Fix

Two layers.

**At publish (Day 25),** [src/reports.js](../../packages/ci-dashboard/src/reports.js) redacts token-shaped strings in text files. Playwright reports keep their data in a zip embedded in the page, which can't be patched in place, so it is unzipped and scanned, and a report containing a token is withheld, not published. An archive that can't be read is withheld too.

**At the source (Day 31).** Writing this page showed the publish scan only protected Pages: the CI artifact still held the tokens. The Postman report now leaves them out:

```
--reporter-htmlextra-skipHeaders "Authorization,Cookie,Set-Cookie"
--reporter-htmlextra-hideResponseBody "Login - Valid"
```

Measured on a live run: 19 tokens → 0, and all 25 assertions still pass. The report still shows every request, status and assertion.

## Regression tests

- [`packages/ci-dashboard/test/reports.test.js`](../../packages/ci-dashboard/test/reports.test.js) › `redact replaces each kind of secret and counts them`
- [`packages/ci-dashboard/test/reports.test.js`](../../packages/ci-dashboard/test/reports.test.js) › `buildReports publishes clean reports, redacts text ones, and withholds zipped data with a token`
- [`packages/postman-api-collection/package.json`](../../packages/postman-api-collection/package.json) › `--reporter-htmlextra-skipHeaders \"Authorization,Cookie,Set-Cookie\"`

Put back on Day 31: disabling the JWT pattern failed 3 report tests. On Day 25, four deliberate breaks to the publish guard each made a test fail.

## Prevention

- **Changing who can see an output is a change that needs review.** An artifact becoming a public page is as much a security change as code is.
- **Remove secrets where they're made, and scan where they're published.** Either layer alone has a gap: the source misses the next report type, and the scan misses everything that isn't published through it.
- **Not covered:** the scan knows token shapes, not every secret. A password in plain text or an unusual key format would get through. Employer and personal names are deliberately not in the public scanner (writing them into public code would name them); that check runs locally before every push.
