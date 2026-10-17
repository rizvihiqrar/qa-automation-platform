// Shared setup for the designed test cases in this folder. Each case IDs itself
// (TC-EP-01 and so on); docs/test-strategy/test-plan.md lists every ID with its
// technique and requirement, and scripts/test-plan.test.mjs checks the two match.
import type { APIRequestContext } from '@playwright/test';

export interface Account {
  id: number;
  email: string;
  auth: { Authorization: string };
}

export interface Product {
  id: number;
  price: number;
  stock: number;
}

let count = 0;
const unique = () => `${process.pid}.${Date.now()}.${count++}`;

export async function signUp(request: APIRequestContext): Promise<Account> {
  const email = `design.${unique()}@example.com`;
  const res = await request.post('/auth/register', { data: { name: 'Design Tester', email, password: 'Pass123!' } });
  if (res.status() !== 201) throw new Error(`sign-up failed: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return { id: body.user.id, email, auth: { Authorization: `Bearer ${body.token}` } };
}

export async function makeProduct(
  request: APIRequestContext, account: Account, fields: Record<string, unknown> = {},
): Promise<Product> {
  const res = await request.post('/products', {
    headers: account.auth,
    data: { name: 'Design Widget', category: 'design', price: 10, stock: 10, ...fields },
  });
  if (res.status() !== 201) throw new Error(`product setup failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function stockOf(request: APIRequestContext, productId: number): Promise<number> {
  return (await (await request.get(`/products/${productId}`)).json()).stock;
}

// A category no other test uses, for list checks that need exact counts.
export const uniqueCategory = () => `design-${unique()}`;
