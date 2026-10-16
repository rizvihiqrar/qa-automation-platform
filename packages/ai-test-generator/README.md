# ai-test-generator

Turns a plain-English feature description into a Playwright test file using the Claude API, then **reviews the generated tests** before anyone commits them.

AI-generated tests are a draft. The reviewer catches the problems they most often have: tests with no assertions, fixed waits, CSS-class or XPath selectors, leftover markdown fences, `test.only`, and missing or duplicate `@smoke` tags.

---

## How It Works

```
feature description (.txt)
        │
        ▼
 buildPrompt()  ── rules: data-test selectors, one @smoke test, no fixed waits, an expect() in every test
        │
        ▼
 Claude API (claude-opus-5-5, refusal fallbacks on)
        │
        ▼
 cleanOutput()  ── strips a stray markdown fence
        │
        ▼
 reviewSpec()   ── flags weak tests; a failing review exits non-zero
        │
        ▼
 tests/generated/<feature>.spec.js
```

---

## Usage

```bash
npm install

# Generate tests (needs ANTHROPIC_API_KEY or an `ant auth login` profile)
npm run generate -- --input examples/input/feature-login.txt

# Review any spec file (no API call)
npm run review
node src/reviewCli.js path/to/spec.js
```

`AI_MODEL` overrides the model (default `claude-opus-5-5`). The request asks for `high` effort and enables server-side refusal fallbacks. A refusal or a response cut off at `max_tokens` is reported as an error, not written to disk.

---

## Tests

| Command | What runs | Count |
|---|---|---:|
| `npm test` | Unit tests for the prompt, the API call (with a fake client, no network), output cleanup, argument parsing, and every review rule | 18 |
| `npm run test:e2e` | The reviewed example spec, `examples/output/login.spec.js`, against the live Sauce Demo site | 4 |

The example spec was generated, then reviewed: the reviewer flagged a CSS class selector, which was changed to `[data-test="inventory-item"]`. The note is in the file header.

---

## Project Structure

```
├── src/
│   ├── generate.js         # CLI: generate, write, then review
│   ├── generator.js        # API call with an injectable client
│   ├── review.js           # Review rules for generated specs
│   ├── reviewCli.js        # CLI: review existing spec files
│   └── prompts/testPrompt.js
├── examples/
│   ├── input/              # Feature descriptions
│   └── output/login.spec.js
└── test/                   # Unit tests (node:test)
```

---

## Limits

- The reviewer reads text, not a syntax tree. Braces inside string literals can confuse its test-body matching.
- Passing the review doesn't mean a test is correct. It means the obvious problems are gone; a person still checks the logic.
