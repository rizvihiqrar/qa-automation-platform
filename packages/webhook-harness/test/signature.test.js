import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../src/signature.js';

const SECRET = 's3cret';
const BODY = '{"type":"order.created","id":42}';
const NOW_MS = 1_800_000_000_000;
const TS = NOW_MS / 1000;
const ok = (overrides = {}) => verify({ secret: SECRET, body: BODY, timestamp: String(TS), signature: sign(SECRET, TS, BODY), nowMs: NOW_MS, ...overrides });

test('sign produces a sha256= hex signature', () => {
  assert.match(sign(SECRET, TS, BODY), /^sha256=[0-9a-f]{64}$/);
});

test('a correct signature verifies', () => {
  assert.deepEqual(ok(), { ok: true });
});

test('a changed body, wrong secret or different timestamp fails', () => {
  assert.equal(ok({ body: BODY.replace('42', '43') }).reason, 'bad-signature');
  assert.equal(ok({ secret: 'other' }).reason, 'bad-signature');
  assert.equal(ok({ signature: sign(SECRET, TS - 1, BODY) }).reason, 'bad-signature');
});

test('missing headers and malformed timestamps are rejected', () => {
  assert.equal(ok({ signature: undefined }).reason, 'missing-headers');
  assert.equal(ok({ timestamp: '' }).reason, 'missing-headers');
  assert.equal(ok({ timestamp: 'yesterday' }).reason, 'bad-timestamp');
});

test('old and far-future timestamps are rejected; small clock skew is allowed', () => {
  const at = (offsetSec) => {
    const ts = TS + offsetSec;
    return verify({ secret: SECRET, body: BODY, timestamp: String(ts), signature: sign(SECRET, ts, BODY), nowMs: NOW_MS });
  };
  assert.equal(at(-301).reason, 'stale-timestamp');
  assert.equal(at(301).reason, 'stale-timestamp');
  assert.equal(at(-299).ok, true);
  assert.equal(at(30).ok, true);
});

test('a signature of the wrong length is rejected without throwing', () => {
  assert.equal(ok({ signature: 'sha256=abc' }).reason, 'bad-signature');
});
