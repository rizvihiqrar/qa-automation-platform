# The AI run

| | |
|---|---|
| Date | 2026-10-17 |
| Model | Claude Opus 5.5, in a Claude Code session (no paid API call) |
| Input | [prompt.md](prompt.md): instructions plus the [reviewed spec](../spec.md) word for word |
| Output | commit `d775d20` ("discount codes, written by AI … (unedited)"), committed before anything was run |
| Edits after generation | none |

## Files the AI changed

| File | Change |
|---|---|
| `packages/qa-practice-api/src/routes/discounts.ts` | new: the four `/discounts` endpoints and `checkDiscount()` for orders |
| `packages/qa-practice-api/src/routes/orders.ts` | `discount_code` on `POST /orders`, amounts in cents, new order fields |
| `packages/qa-practice-api/src/db/store.ts` | `Discount` type and table; `subtotal`, `discount_code`, `discount` on `Order` |
| `packages/qa-practice-api/src/app.ts` | mounts `/discounts` |
| `packages/api-drift-checker/spec/qa-practice-api.openapi.json` | the new endpoints, request field, 422 response, order fields and `Discount` schema |

It did not touch the package README's API reference (the prompt didn't ask for it); that was added by hand in a later commit.

## The gates the prompt set

Run straight after the commit, on 2026-10-17:

| Gate | Result |
|---|---|
| Root `npm run typecheck` (strict TypeScript) | 23/23 packages clean |
| Existing qa-practice-api tests | 165/165 pass |
| api-drift-checker unit tests | 17/17 pass |
| Drift check against the running API | 27/27 responses match the spec; it also lists the four `/discounts` operations as never called |
| Root `npm test` | 60/60 pass |

Every gate is green, and not one of them ran a line of the discount code: the existing tests never send `discount_code`, and nothing calls `/discounts`. Green here means the AI broke nothing that was already tested. Whether discount codes work is Day 38's question.

## Limits of this run

- **The same model reviewed the spec and wrote the code, in one session.** A developer handed the spec cold would not have read the review log first. The code was written in one pass from the prompt and not run before the commit, and no bugs were added on purpose, but this is a weaker separation than a different tool or person would give.
- **One run.** Asked again, the same prompt would give different code with different mistakes. The findings on Days 38 and 39 describe this output, not what AI-written code gets wrong in general.
