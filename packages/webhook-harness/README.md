# webhook-harness

A webhook receiver and sender with the tests that prove the hard parts work: signature checks, replay protection, processing each delivery only once, and retrying failures the right way.

**In plain English:** a webhook is one system calling another to say "this happened" (an order was paid, a build finished). The receiver has to be sure the message is genuine, not a copy of an old one, and not processed twice when the sender retries. These are easy to get wrong and hard to notice until money is counted twice.

---

## Demo

```
$ npm run demo

Valid delivery                     delivered after 1 attempt(s)
Same delivery id sent again        accepted as duplicate, not processed twice
Handler fails twice, then works    delivered after 3 attempts (500, 500, 200)
Body changed after signing         rejected with 401
Signed an hour ago (replay)        rejected with 401
Wrong secret                       rejected after 1 attempt (no retry on 401)

Events processed: order.created, order.flaky
```

---

## What It Checks

| Concern | Behaviour | Test |
|---|---|---|
| Authenticity | HMAC-SHA256 over `timestamp.body`, compared in constant time | changed body, wrong secret, wrong timestamp all fail |
| Replay | Timestamps older or newer than 5 minutes are rejected | 301 seconds off fails, 299 passes |
| Idempotency | A delivery id is processed once; repeats get `200 duplicate` | handler runs once for two sends |
| Concurrent duplicates | A copy arriving while the first is still processing gets `409` | two simultaneous sends, one processing |
| Failed processing | Handler error → `500`, and the id is **not** marked done, so the retry works | fails, then succeeds on retry |
| Retries | 5xx, 408, 429 and network errors retry with doubling backoff (200, 400, 800 ms…) | delays recorded with a fake clock |
| No pointless retries | Other 4xx stop at once | 400, 401, 404, 422 each sent once |
| Re-signing | Each retry gets a fresh timestamp and signature, but keeps the same delivery id | headers compared across attempts |

---

## Bug the Tests Caught

The first version of the receiver checked "already processed?" and then ran the handler. Two copies of the same delivery arriving together both passed that check before either finished, so the event ran twice. The fix tracks deliveries in progress and answers a concurrent copy with `409`.

Removing that guard makes the concurrency test fail, which confirms the test really detects the race.

---

## Usage

```js
import { createReceiver, startServer } from './src/receiver.js';
import { deliver } from './src/sender.js';

const { listener } = createReceiver({ secret: process.env.WEBHOOK_SECRET, handler: async (event, id) => { /* do the work */ } });
const { url } = await startServer(listener);

await deliver({ url, secret: process.env.WEBHOOK_SECRET, event: { type: 'order.paid', orderId: 7 } });
```

Headers: `x-webhook-signature` (`sha256=<hex>`), `x-webhook-timestamp` (Unix seconds), `x-webhook-id`.

---

## Tests

```bash
npm test   # 20 tests, no dependencies
```

The receiver tests run against a real local HTTP server. The sender tests use a fake network and a fake clock, so retry timing is checked without any real waiting.
