// Spike: browsing traffic jumps from 2 to 40 users in a few seconds, then drops.
// Checks the API keeps answering correctly during a sudden burst.
import { sleep } from 'k6';
import { register, createProducts, browse, summaryWriter } from './lib.js';

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '5s', target: 2 },
        { duration: '3s', target: 40 },
        { duration: '10s', target: 40 },
        { duration: '3s', target: 2 },
      ],
      gracefulRampDown: '3s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{name:list products}': ['p(95)<400'],
    'http_req_duration{name:get product}': ['p(95)<400'],
  },
};

export function setup() {
  const admin = register('spike-setup');
  return { productIds: createProducts(admin.token, 20) };
}

export default function ({ productIds }) {
  browse(productIds);
  sleep(0.3);
}

export const handleSummary = summaryWriter('spike');
