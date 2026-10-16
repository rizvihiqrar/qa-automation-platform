// Load: a realistic mix. Most traffic browses products; some users log in and
// order. Ramps to 20 virtual users, holds, then ramps down.
import { sleep } from 'k6';
import exec from 'k6/execution';
import { register, login, createProducts, browse, placeOrder, summaryWriter } from './lib.js';

export const options = {
  scenarios: {
    shoppers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 20 },
        { duration: '20s', target: 20 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Set from measurement, not guesswork: browsing is ~1 ms at p95. The old
    // 250 ms limit passed the event-loop blocking bug (67–84 ms); 50 ms catches it.
    'http_req_duration{name:list products}': ['p(95)<50'],
    'http_req_duration{name:get product}': ['p(95)<50'],
    'http_req_duration{name:login}': ['p(95)<800'],
    'http_req_duration{name:place order}': ['p(95)<300'],
  },
};

export function setup() {
  const admin = register('load-setup');
  // A pool of accounts created up front, so the test measures logins, not sign-ups.
  const users = Array.from({ length: 10 }, (_, i) => register(`load-${i}`));
  return { productIds: createProducts(admin.token, 20), users };
}

// LOGIN_EVERY=4 (default): one iteration in four logs in and orders.
// LOGIN_EVERY=0 turns logins off, to compare browsing with and without them.
const LOGIN_EVERY = Number(__ENV.LOGIN_EVERY ?? 4);

export default function ({ productIds, users }) {
  browse(productIds);
  if (LOGIN_EVERY > 0 && exec.scenario.iterationInTest % LOGIN_EVERY === 0) {
    const token = login(users[exec.vu.idInTest % users.length]);
    placeOrder(token, productIds);
  }
  sleep(0.5);
}

export const handleSummary = summaryWriter('load');
