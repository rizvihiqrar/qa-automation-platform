// Delivers a webhook with retries. Retries server errors, timeouts and rate limits
// with exponential backoff; stops at once on other client errors, because sending
// the same bad request again won't fix it. The delivery id stays the same across
// retries so the receiver can de-duplicate; the signature is recomputed each time
// with a fresh timestamp.

import { randomUUID } from 'crypto';
import { HEADERS, sign } from './signature.js';

const RETRYABLE_4XX = new Set([408, 429]);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function backoffDelays(maxAttempts, baseDelayMs) {
  return Array.from({ length: maxAttempts - 1 }, (_, i) => baseDelayMs * 2 ** i);
}

export async function deliver({
  url, secret, event,
  id = randomUUID(),
  maxAttempts = 5,
  baseDelayMs = 200,
  sleep = realSleep,
  nowMs = () => Date.now(),
  fetchImpl = fetch,
}) {
  const body = JSON.stringify(event);
  const delays = backoffDelays(maxAttempts, baseDelayMs);
  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timestamp = Math.floor(nowMs() / 1000);
    let status = null;
    let error = null;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [HEADERS.id]: id,
          [HEADERS.timestamp]: String(timestamp),
          [HEADERS.signature]: sign(secret, timestamp, body),
        },
        body,
      });
      status = res.status;
    } catch (err) {
      error = err.message;
    }
    attempts.push({ attempt, status, error, timestamp });

    if (status !== null && status >= 200 && status < 300) return { delivered: true, id, attempts };
    if (status !== null && status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)) {
      return { delivered: false, reason: 'rejected', id, attempts };
    }
    if (attempt < maxAttempts) await sleep(delays[attempt - 1]);
  }
  return { delivered: false, reason: 'gave-up', id, attempts };
}
