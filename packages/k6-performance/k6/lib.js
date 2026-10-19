// Shared helpers for the k6 scripts. Every request gets a `name` tag so results
// and thresholds can be broken down per endpoint.
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const authHeaders = (token) => ({ ...JSON_HEADERS, Authorization: `Bearer ${token}` });

export function register(tag) {
  const email = `k6-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
  // Throwaway account on the local qa-practice-api server; src/run.js passes K6_USER_PASSWORD through.
  const password = __ENV.K6_USER_PASSWORD || 'Load-test-1!';
  const res = http.post(`${BASE_URL}/auth/register`, JSON.stringify({ name: 'k6 user', email, password }), { headers: JSON_HEADERS, tags: { name: 'register' } });
  check(res, { 'register 201': (r) => r.status === 201 });
  return { email, password, token: res.json('token') };
}

// Products can only be created by an admin. src/run.js seeds the server with one
// and passes the same credentials here.
export function adminLogin() {
  if (!__ENV.ADMIN_EMAIL || !__ENV.ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set (src/run.js sets them)');
  return login({ email: __ENV.ADMIN_EMAIL, password: __ENV.ADMIN_PASSWORD });
}

export function login(user) {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email: user.email, password: user.password }), { headers: JSON_HEADERS, tags: { name: 'login' } });
  check(res, { 'login 200': (r) => r.status === 200 });
  return res.json('token');
}

export function createProducts(token, count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const res = http.post(`${BASE_URL}/products`, JSON.stringify({ name: `Item ${i}`, category: i % 2 ? 'bags' : 'lights', price: 10 + i, stock: 100000 }), { headers: authHeaders(token), tags: { name: 'create product' } });
    check(res, { 'create product 201': (r) => r.status === 201 });
    ids.push(res.json('id'));
  }
  return ids;
}

export function browse(productIds) {
  const list = http.get(`${BASE_URL}/products?limit=20`, { tags: { name: 'list products' } });
  check(list, { 'list 200': (r) => r.status === 200 });
  const id = productIds[Math.floor(Math.random() * productIds.length)];
  const one = http.get(`${BASE_URL}/products/${id}`, { tags: { name: 'get product' } });
  check(one, { 'get product 200': (r) => r.status === 200 });
}

export function placeOrder(token, productIds) {
  const id = productIds[Math.floor(Math.random() * productIds.length)];
  const res = http.post(`${BASE_URL}/orders`, JSON.stringify({ items: [{ product_id: id, quantity: 1 }] }), { headers: authHeaders(token), tags: { name: 'place order' } });
  check(res, { 'order 201': (r) => r.status === 201 });
}

// Writes the full k6 summary as JSON for src/summarize.js, plus one line to stdout.
export function summaryWriter(testName) {
  return (data) => ({
    [`results/${testName}.json`]: JSON.stringify(data, null, 2),
    stdout: `${testName}: ${data.metrics.http_reqs?.values?.count ?? 0} requests, summary written to results/${testName}.json\n`,
  });
}
