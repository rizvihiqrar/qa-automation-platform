# qa-for-ai-features

Test patterns for AI-powered features: response schema checks, latency SLAs, and content-safety guardrails. The tests run against a local mock that returns Claude-style message responses, and the same tests can point at a real AI API through `AI_BASE_URL`.

**In plain English:** Products with AI features need extra checks: is the answer in the right format, does it arrive fast enough, and does the AI refuse harmful requests? These tests check all three against a stand-in AI service, so they cost nothing and give the same result every time.

---

## What It Tests

| File | Tests | Pattern |
|---|---:|---|
| `response-schema.spec.ts` | 5 | Required top-level fields, a non-empty text content block, numeric token usage, a known `stop_reason`, and a 400 (not a crash) for a malformed request |
| `latency-sla.spec.ts` | 3 | A normal request finishes inside a 5-second SLA; latency is logged; a deliberately slow response fails the SLA check |
| `content-safety.spec.ts` | 4 | Normal prompts get a helpful answer; harmful prompts get a refusal; refusals still match the schema; text is never empty |

**12 tests across 3 files.** Everything is strict TypeScript, run by Node 24 and Playwright without a build step.

---

## Running

```bash
npm install
npx playwright test          # all tests
npm run smoke                # @smoke only
```

Playwright starts the mock server (`mocks/aiServer.ts`, port 3031) once for the whole run. The mock returns a refusal for prompts with harmful keywords and waits 6 seconds for prompts containing `simulate_slow`.

To run against a real API, set `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY`. The schema and safety assertions stay the same; expect latency and refusal wording to differ.

---

## Fix Log

The suite used to start a mock server in each spec file's `beforeAll`. Playwright runs files in parallel workers, so two files tried to bind port 3031 at once and one failed with `EADDRINUSE`. The server now starts once through Playwright's `webServer` option.

Converting to TypeScript (Day 19) found two more:

- The slow-response test passed `15000` as a third argument to `test()` to extend its timeout. Playwright has no such parameter, so it was silently ignored; the test only passed because the config timeout happened to be 15 seconds. It now calls `test.setTimeout(15_000)`.
- A request body that wasn't valid JSON threw inside the mock server's request handler and crashed the server for every test after it. It now answers `400`, and a test sends a truncated body to prove the server keeps serving.
