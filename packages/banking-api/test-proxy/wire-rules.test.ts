import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Flow } from './proxy.ts';
import { wireProblems } from './wire.ts';

// The wire checks, tried on recordings made to break them: a check that can't fail
// proves nothing. No Docker needed. Each case is one planted defect and the one
// problem it must be reported as.

const SECURE: [string, string][] = [['Content-Type', 'application/json; charset=utf-8'], ['Cache-Control', 'no-store'], ['X-Content-Type-Options', 'nosniff']];
const flow = (over: Partial<Flow> = {}): Flow => ({
  method: 'GET', path: '/accounts', request_headers: [], request_body: '', status: 200,
  response_headers: SECURE, response_body: '{}', changed: null, ...over,
});

test('BK-R41 a clean recording has no problems', () => {
  assert.deepEqual(wireProblems([
    flow(), flow({ path: '/accounts/12/entries' }), flow({ method: 'POST', path: '/transfers', status: 201 }), flow({ path: '/transfers/3' }),
    flow({ path: '/', response_headers: [...SECURE, ['Content-Security-Policy', "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"]] }),
  ], ['Alice']), []);
});

for (const [defect, planted, expected] of [
  ['an amount in a query string', flow({ path: '/transfers?amount=10.00' }), /query string/],
  ['a fragment', flow({ path: '/accounts#top' }), /query string or fragment/],
  ['a route that is not one', flow({ path: '/admin/export' }), /not a route/],
  ['an id with leading zeros', flow({ path: '/accounts/007' }), /not a route/],
  ['a broken percent escape (reported, not thrown)', flow({ path: '/accounts/%E0%A4%A' }), /not a route/],
  ['an owner name in the path', flow({ path: '/accounts/Alice' }), /"Alice" is in the URL/],
  ['a cookie in a reply', flow({ response_headers: [...SECURE, ['Set-Cookie', 'sid=1']] }), /set-cookie header/],
  ['a Server header', flow({ response_headers: [...SECURE, ['Server', 'node/24']] }), /server header/],
  ['an X-Powered-By header', flow({ response_headers: [...SECURE, ['x-powered-by', 'Express']] }), /x-powered-by header/],
  ['a reply that can be cached', flow({ response_headers: [['Cache-Control', 'max-age=60'], ['X-Content-Type-Options', 'nosniff']] }), /not Cache-Control: no-store/],
  ['a reply without nosniff', flow({ response_headers: [['Cache-Control', 'no-store']] }), /not nosniff/],
  ['a UI page without its policy', flow({ path: '/app.js' }), /no Content-Security-Policy/],
  ['a reply that repeats the key', flow({ method: 'POST', path: '/transfers', request_headers: [['Idempotency-Key', 'k-123']], response_body: '{"echo":"k-123"}' }), /repeats the Idempotency-Key/],
] as const) {
  test(`BK-R41 BK-R18 BK-R32 the wire checks report ${defect}`, () => {
    const problems = wireProblems([planted], ['Alice']);
    assert.ok(problems.some((p) => expected.test(p)), `not reported: ${problems.join(' | ') || 'no problems'}`);
    assert.ok(problems.length <= 2, problems.join(' | ')); // a name in the path is also not a route
  });
}
