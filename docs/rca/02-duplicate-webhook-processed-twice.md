# Duplicate webhook processed twice

| | |
|---|---|
| **Where** | [webhook-harness](../../packages/webhook-harness): the receiver, then the sender |
| **Found by** | The receiver's concurrency test, written with the first version (Day 7). The follow-on sender bug was found while writing this page (Day 31) |
| **Impact** | An event such as "order paid" could run twice: a double charge, a duplicate email. The follow-on bug could lose an event entirely |
| **Fixed in** | Receiver: commit `7a3be23` (Day 7, before the first push). Sender: Day 31 |

## Symptom

Two copies of the same delivery (same delivery id) sent at the same moment both got `200 processed`, and the handler ran twice. A copy sent after the first had finished was correctly answered `200 duplicate`.

## How it was found

Webhook senders retry on timeouts, so duplicates are normal, and the receiver has to process each delivery id once. The obvious test (send, then send again) passed. The concurrency test sends both copies with `Promise.all` while the handler is slowed to 150 ms, so the second arrives while the first is still working. That one failed: the handler count was 2.

## Root cause

A check-then-act gap across an `await`:

```js
// receiver, first version
if (processed.has(id)) return send(res, 200, { status: 'duplicate' });
await handler(event, id);   // copy 2 arrives here and passes the check above
processed.set(id, nowMs());
```

Node runs one request at a time, but only up to each `await`. While copy 1 waited for its handler, copy 2 ran the check, and the id wasn't marked yet because it is only marked after the handler succeeds. That order is deliberate: if the handler fails, the id must stay unmarked so the retry works.

**Why the obvious test missed it:** sequential sends never interleave. Only sends that overlap the `await` hit the gap.

## Fix

Track ids in progress, and answer a copy that arrives meanwhile with `409`:

```js
if (inFlight.has(id)) return send(res, 409, { error: 'in-progress' });
inFlight.add(id);
try { await handler(event, id); } catch { return send(res, 500, ...); }
finally { inFlight.delete(id); }
processed.set(id, nowMs());
```

`409`, not `200`: the first attempt may still fail, and `200` tells the sender to stop.

### The follow-on bug (found on Day 31)

Writing this page meant following the `409` to the sender, which treated it like any other client error and **stopped retrying**. Duplicates usually happen like this:

1. Attempt 1 reaches the receiver, but the sender times out waiting.
2. The sender retries. Attempt 2 gets `409`, because attempt 1 is still running. The sender gives up.
3. Attempt 1's handler then fails and answers `500` to a sender that has stopped listening.

The id was never marked processed and nobody retries, so the event is lost. An end-to-end test reproduced it (attempts `[network error, 409]`, handler never succeeded). The fix is one line: `409` joins `408` and `429` as retryable, so the next attempt finds either `duplicate` (attempt 1 succeeded) or a free id (it failed) and processes it.

## Regression tests

- [`packages/webhook-harness/test/receiver.test.js`](../../packages/webhook-harness/test/receiver.test.js) › `two copies of one delivery arriving together are processed once`
- [`packages/webhook-harness/test/sender.test.js`](../../packages/webhook-harness/test/sender.test.js) › `end to end: a retry that meets 409 keeps retrying, so a slow attempt that then fails is not lost`
- [`packages/webhook-harness/test/sender.test.js`](../../packages/webhook-harness/test/sender.test.js) › `network errors, 408, 409 and 429 are retried`

Put back on Day 31: removing the in-progress guard fails the first test (19 of 20 pass). Without `409` in the retry list, the end-to-end test fails with attempts `[null, 409]`. The end-to-end test steps through with promises (wait until the receiver has started, then abort; release the handler only before attempt 3), not timers, so the order is exact. 10 runs, 21/21 each.

## Prevention

- **Test duplicates concurrently, not just in sequence.** Any "only once" rule gets a test where the copies overlap the slow part.
- **Follow every status code to whoever receives it.** The receiver's `409` was right; the bug was what the sender did with it. Both sides now have a test for that code.
- **Not covered:** the in-progress set lives in memory, so two receiver instances behind a load balancer would each let one copy through. A real deployment needs the guard in shared storage (a unique key in the database). The README says this is a single-process harness.
