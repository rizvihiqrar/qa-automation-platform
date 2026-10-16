// Smoke: one user walks the main journey for a short time. Proves the scripts
// and the API work before any load is applied.
import { sleep } from 'k6';
import { register, login, createProducts, browse, placeOrder, summaryWriter } from './lib.js';

export const options = {
  vus: 1,
  duration: '10s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{name:list products}': ['p(95)<50'],
    'http_req_duration{name:get product}': ['p(95)<50'],
  },
};

export function setup() {
  const admin = register('smoke-setup');
  return { productIds: createProducts(admin.token, 10) };
}

export default function ({ productIds }) {
  const user = register('smoke');
  const token = login(user);
  browse(productIds);
  placeOrder(token, productIds);
  sleep(1);
}

export const handleSummary = summaryWriter('smoke');
