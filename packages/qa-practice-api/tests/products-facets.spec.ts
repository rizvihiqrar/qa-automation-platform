import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminToken } from './admin.ts';

// A496: the counts on filter chips must add up. GET /products/facets returns one count
// per category plus the All total, and a product with no category is counted under the
// empty name "" (what ?category= returns for it) instead of being left out. These tests make their own categories
// (named with the run time), so other specs creating products at the same time
// cannot change the counts being checked.
const run = Date.now();
const auth = () => ({ Authorization: `Bearer ${adminToken()}` });

async function addProduct(request: APIRequestContext, category: string, n: number) {
  const res = await request.post('/products', {
    headers: auth(),
    data: { name: `Facet item ${run}-${category}-${n}`, category, price: 5 },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as number;
}

async function facets(request: APIRequestContext) {
  const res = await request.get('/products/facets');
  expect(res.status()).toBe(200);
  return await res.json() as { all: number; categories: Record<string, number> };
}

test.describe('Products facets (filter counts)', () => {
  test('the category counts add up to All @regression', async ({ request }) => {
    const mugs = `mugs-${run}`;
    const caps = `caps-${run}`;
    for (let i = 0; i < 3; i++) await addProduct(request, mugs, i);
    for (let i = 0; i < 2; i++) await addProduct(request, caps, i);

    const { all, categories } = await facets(request);
    const sum = Object.values(categories).reduce((a, b) => a + b, 0);
    expect(sum).toBe(all);
    expect(categories[mugs]).toBe(3);
    expect(categories[caps]).toBe(2);
  });

  test('each chip count equals the total the category filter returns @regression', async ({ request }) => {
    const tea = `tea-${run}`;
    for (let i = 0; i < 4; i++) await addProduct(request, tea, i);

    const { categories } = await facets(request);
    const filtered = await request.get(`/products?category=${tea}&limit=1`);
    expect((await filtered.json()).total).toBe(categories[tea]);
  });

  test('a product with no category is counted under "", so the counts still add up and match the filter @regression', async ({ request }) => {
    const temp = `temp-${run}`;
    const id = await addProduct(request, temp, 0);
    expect((await facets(request)).categories[temp]).toBe(1);

    // Clearing the category through PUT is allowed, so this is how a gap can appear.
    const put = await request.put(`/products/${id}`, { headers: auth(), data: { category: '' } });
    expect(put.status()).toBe(200);

    const after = await facets(request);
    expect(after.categories[temp]).toBeUndefined();
    expect(after.categories['']).toBeGreaterThanOrEqual(1);
    expect(Object.values(after.categories).reduce((a, b) => a + b, 0)).toBe(after.all);
  });

  test('category names that are also object property names are counted like any other @regression', async ({ request }) => {
    // A plain object used as the counter would read "constructor" as an inherited
    // function and drop "__proto__" silently.
    const names = ['constructor', 'toString', '__proto__'];
    for (const name of names) await addProduct(request, name, 0);

    const { all, categories } = await facets(request);
    for (const name of names) expect(Object.getOwnPropertyDescriptor(categories, name)?.value).toBeGreaterThanOrEqual(1);
    expect(Object.values(categories).reduce((a, b) => a + b, 0)).toBe(all);
  });

  test('facets is public and is not read as a product id @smoke', async ({ request }) => {
    const res = await request.get('/products/facets');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ all: expect.any(Number), categories: expect.any(Object) });
  });
});
