# postman-api-collection

Postman collection for the public [DummyJSON](https://dummyjson.com) REST API, run with [Newman](https://github.com/postmanlabs/newman). It covers user CRUD, token authentication, pagination, and error handling, and it can be imported straight into Postman.

**In plain English:** Postman is a popular tool for trying out APIs by hand. This turns those checks into a collection that runs automatically and produces a readable report.

---

## What It Tests

| Folder | Requests | Checks | Coverage |
|---|---:|---:|---|
| Smoke | 5 | 12 | List users, get one user, create a user, valid login, current user with a token |
| Regression | 7 | 13 | Pagination, 404 for unknown users, PUT, PATCH, DELETE, wrong password, current user without a token |

**12 requests, 25 checks.**

The login request saves the access token to a collection variable, and later requests reuse it. The "No Token" request turns off cookies, because DummyJSON also sets the token as a cookie and Newman would otherwise send it.

---

## Project Structure

```
├── collection/
│   └── dummyjson-api.postman_collection.json   # Importable Postman collection
└── package.json                                # Newman scripts
```

---

## Quick Start

From this folder:

```bash
npm install

npm test             # full collection, CLI and HTML report
npm run smoke        # Smoke folder only
npm run regression   # Regression folder only
```

To use it in Postman: **Import**, select `collection/dummyjson-api.postman_collection.json`, then run it with the Collection Runner.

---

## Reports

`npm test` writes an HTML report to `reports/report.html` using `newman-reporter-htmlextra`. The platform CI uploads it as a build artifact.

The report leaves out the `Authorization`, `Cookie` and `Set-Cookie` headers and the body of the valid login response. Those held DummyJSON's live access and refresh tokens: 19 of them per report. The Pages publisher already redacted them, but the build artifact itself still had them. Now 0 (see [the write-up](../../docs/rca/05-tokens-in-published-reports.md)).

---

## Tech Stack

- **Postman**: collection and test scripts (`pm.test`)
- **Newman**: command-line runner
- **newman-reporter-htmlextra**: HTML reports
