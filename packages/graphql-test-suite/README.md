# graphql-test-suite

Playwright API tests for a GraphQL endpoint, covering queries, variables, filtering, pagination, error handling, and schema introspection. Includes a self-contained local mock server so the suite runs reliably without internet dependencies.

**In plain English:** GraphQL is a way for apps to ask a server for exactly the data they need. These tests check that the server answers correctly, including when the question itself is wrong.

## Stack

- **Playwright** (API mode) — no browser, pure HTTP testing
- **graphql-yoga** — lightweight local mock server (starts automatically via `webServer`)
- **GitHub Actions** — runs the full suite including server startup

## Running Tests

```bash
npm install
npm test
```

Playwright starts the mock GraphQL server on port 4001 automatically before any tests run. No separate server command needed.

## Test Suites

### `queries.spec.js` — Basic query structure
| Test | What it verifies |
|---|---|
| Valid query → HTTP 200 | GraphQL uses 200 even for partial failures |
| `data` present, `errors` absent | Baseline response shape |
| Content-type is `application/json` | Clients can safely call `.json()` |
| Paginated list shape | `info { count pages next prev }` + `results` |
| Field types match schema | Status enum, id as string |
| Query with variables = inline query | Parameterisation is transparent |
| Multi-resource in one request | `character` + `location` + `episode` in one roundtrip |

### `filtering.spec.js` — Filter variables
- Name filter: only matching characters returned (substring match)
- Status filter: returns only Alive / Dead
- Combined filters: AND semantics
- No-match filter: count 0 or `characters: null` (both acceptable)
- Pagination across filtered results: page 2 ≠ page 1

### `error-handling.spec.js` — Error response shape
- Unknown field → `errors` array, not 5xx (RFC-compliant 400 is acceptable)
- Error objects have `message` and `locations` fields
- Non-existent ID → null data, no crash
- Malformed syntax → `errors` array (400 or 200 both valid)
- Empty query → `errors` array

### `introspection.spec.js` — Schema validation
- `__schema` returns the Query type name
- `Character`, `Location`, `Episode` types all present with expected fields
- `FilterCharacter` is an `INPUT_OBJECT` with `name`, `status`, `species`, `gender`
- `character(id)` entry point returns a nullable `Character` (not a list)

## Key GraphQL Testing Concepts

**GraphQL always returns HTTP 200 for data responses** — errors live in the `errors` array, not in the HTTP status. The exception (allowed by the spec) is request-level errors (bad syntax, unknown field) which may return 400.

**Test both the transport and the payload**: assert `status === 200`, `content-type` is JSON, and that `data`/`errors` are correctly populated. A 200 response with `data: null` and an `errors` array is a failure — not a success.

**Introspection tests as schema contracts**: if a type or field changes, introspection tests fail before any data tests run. They act as a fast schema change detector.

## Project Structure

```
graphql-test-suite/
├── server/
│   ├── data.js         25 characters, 4 locations, 5 episodes (in-memory)
│   └── index.js        graphql-yoga server on port 4001
├── tests/
│   ├── queries.spec.js
│   ├── filtering.spec.js
│   ├── error-handling.spec.js
│   └── introspection.spec.js
├── utils/
│   └── graphqlClient.js  thin Playwright wrapper for POST /graphql
└── playwright.config.js  webServer auto-starts the mock server
```
