/**
 * Thin wrapper around Playwright's request API for GraphQL.
 *
 * Returns the full parsed body plus status and headers so tests can
 * check the transport layer (status code, content-type) alongside
 * the GraphQL response (data, errors).
 *
 * Falls back gracefully if the endpoint returns a non-JSON response
 * (e.g. a CDN rate-limit HTML page) so tests fail with a clear message
 * rather than a SyntaxError.
 */

const ENDPOINT = process.env.GQL_URL || 'http://localhost:4001/graphql';

export async function gql(request, query, variables = {}) {
  const res  = await request.post(ENDPOINT, {
    data:    { query, variables },
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  });

  const ct   = res.headers()['content-type'] || '';
  let body;

  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    const text = await res.text();
    // Non-JSON from the CDN (rate limit page, maintenance) — surface as an error
    body = { data: null, errors: [{ message: `Non-JSON response (${res.status()}): ${text.slice(0, 120)}` }] };
  }

  return {
    status:  res.status(),
    headers: res.headers(),
    data:    body.data   ?? null,
    errors:  body.errors ?? null,
  };
}
