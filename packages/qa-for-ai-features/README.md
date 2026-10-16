# qa-for-ai-features

Test patterns for AI-powered features: response schema checks, latency SLAs, and content-safety guardrails. The tests run against a local mock that returns Claude-style message responses, and the same tests can point at a real AI API through `AI_BASE_URL`.

---

## What It Tests

| File | Tests | Pattern |
|---|---:|---|
| `response-schema.spec.js` | 4 | Required top-level fields, a non-empty text content block, numeric token usage, a known `stop_reason` |
| `latency-sla.spec.js` | 3 | A normal request finishes inside a 5-second SLA; latency is logged; a deliberately slow response fails the SLA check |
| `content-safety.spec.js` | 4 | Normal prompts get a helpful answer; harmful prompts get a refusal; refusals still match the schema; text is never empty |

**11 tests across 3 files.**

---

## Running

```bash
npm install
npx playwright test          # all tests
npm run smoke                # @smoke only
```

Playwright starts the mock server (`mocks/aiServer.js`, port 3031) once for the whole run. The mock returns a refusal for prompts with harmful keywords and waits 6 seconds for prompts containing `simulate_slow`.

To run against a real API, set `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY`. The schema and safety assertions stay the same; expect latency and refusal wording to differ.

---

## Fix Log

The suite used to start a mock server in each spec file's `beforeAll`. Playwright runs files in parallel workers, so two files tried to bind port 3031 at once and one failed with `EADDRINUSE`. The server now starts once through Playwright's `webServer` option.
