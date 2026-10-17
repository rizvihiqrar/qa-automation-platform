import { test, expect } from '@playwright/test';

// The two headers the ZAP scan found missing (zap/rules.tsv, README "Security scan").
// The scan only fails on them in CI; this checks them on every kind of response,
// including the error paths ZAP's requests don't always reach.

const HEADERS = { 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' };

test.describe('security headers', () => {
  const cases: [label: string, path: string, status: number][] = [
    ['a 200', '/health', 200],
    ['a 401', '/auth/me', 401],
    ['a 404 for an unknown route', '/nowhere', 404],
  ];
  for (const [label, path, status] of cases) {
    test(`${label} carries nosniff and same-origin CORP @regression`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(status);
      expect(res.headers()).toMatchObject(HEADERS);
    });
  }

  test('a malformed-JSON 400 from the error handler carries them too @regression', async ({ request }) => {
    const res = await request.post('/auth/login', { data: Buffer.from('{"email":') });
    expect(res.status()).toBe(400);
    expect(res.headers()).toMatchObject(HEADERS);
  });
});
