// HMAC-SHA256 webhook signatures, in the common "sha256=<hex>" header style.
// The timestamp is signed together with the body, so an attacker can't reuse an
// old signature with a fresh timestamp.

import { createHmac, timingSafeEqual } from 'crypto';

export const HEADERS = {
  signature: 'x-webhook-signature',
  timestamp: 'x-webhook-timestamp',
  id: 'x-webhook-id',
};

export function sign(secret, timestamp, body) {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// Returns { ok: true } or { ok: false, reason }.
// toleranceSec bounds how old (or how far in the future) a timestamp may be.
export function verify({ secret, body, timestamp, signature, nowMs = Date.now(), toleranceSec = 300 }) {
  if (!timestamp || !signature) return { ok: false, reason: 'missing-headers' };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: 'bad-timestamp' };
  if (Math.abs(nowMs / 1000 - ts) > toleranceSec) return { ok: false, reason: 'stale-timestamp' };

  const expected = Buffer.from(sign(secret, ts, body));
  const given = Buffer.from(String(signature));
  // timingSafeEqual throws on different lengths, and a plain === leaks timing.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad-signature' };
  return { ok: true };
}
