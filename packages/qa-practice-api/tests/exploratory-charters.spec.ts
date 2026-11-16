import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminToken } from './admin.ts';

// A162: what three exploratory sessions on the product list found (the sessions are in
// packages/exploratory-session-tracker/sessions/qa-practice-api, written up in its docs).
// Each finding got an id, EX-00 to EX-10, and a test here:
//
//   - A pin passes today. It records behaviour the session looked at and judged worth keeping,
//     so changing it later is a decision and not an accident.
//   - An expected failure (test.fail) is a real bug, written as the behaviour it should have.
//     It passes while the bug is there. The day the bug is fixed it fails with "expected to fail
//     but passed", and the fix removes the test.fail() line. Nothing in the product was changed
//     to make these tests pass: A162 finds and pins, it does not fix.
//
// Every test makes its own categories (named with the run time), so other specs creating
// products at the same time cannot change what is checked.
const run = Date.now();
const auth = () => ({ Authorization: `Bearer ${adminToken()}` });

async function add(request: APIRequestContext, name: string, category: unknown) {
  return request.post('/products', { headers: auth(), data: { name, category, price: 5 } });
}

async function addOk(request: APIRequestContext, name: string, category: string): Promise<number> {
  const res = await add(request, name, category);
  expect(res.status()).toBe(201);
  return (await res.json()).id as number;
}

test.describe('Exploratory charters: the product list (A162)', () => {
  test('EX-00: a category with an awkward name is found by exactly that name @regression', async ({ request }) => {
    // The bare names that a plain-object counter would trip over, as they are; a run-time
    // suffix would turn them into ordinary strings. Other specs may add products named the
    // same, so each test checks that its own product is in the answer and that nothing in
    // the answer is in another category.
    const names = ['constructor', '__proto__', 'null', 'undefined', 'C++', '100%', '日本語'];
    const ids = new Map<string, number>();
    for (const name of names) ids.set(name, await addOk(request, `item ${name} ${run}`, name));
    for (const name of names) {
      const body = await (await request.get(`/products?category=${encodeURIComponent(name)}&limit=100`)).json();
      expect(body.data.map((p: { id: number }) => p.id), name).toContain(ids.get(name));
      for (const p of body.data) expect(p.category, name).toBe(name);
    }
  });

  test('EX-01: a filter that is not one string does not return the whole catalogue @regression', async ({ request }) => {
    test.fail(); // bug: category=a&category=b, category[]=a and category[x]=y are ignored, and every product comes back
    const mine = `ex01-${run}`;
    // A product in another category must exist, or "everything" and "only mine" look the same.
    await addOk(request, `item other ${mine}`, `${mine}-other`);
    await addOk(request, `item ${mine}`, mine);
    for (const query of [`category=${mine}&category=${mine}`, `category[]=${mine}`, `category[x]=${mine}`]) {
      const res = await request.get(`/products?${query}&limit=50`);
      if (res.status() === 400) continue; // rejecting the shape is a right answer
      expect(res.status(), query).toBe(200);
      const { data } = await res.json();
      for (const p of data) expect(p.category, `${query} returned a product in ${p.category}`).toBe(mine);
    }
  });

  test('EX-02: a hexadecimal page number is not read as a page @regression', async ({ request }) => {
    test.fail(); // bug: page=0x10 is read as page 16 (parseInt with no radix)
    const res = await request.get('/products?page=0x10');
    if (res.status() === 400) return;
    expect((await res.json()).page).toBe(1);
  });

  test('EX-03: a page number past the largest exact integer is not echoed back @regression', async ({ request }) => {
    test.fail(); // bug: page=99999999999999999999 answers page: 100000000000000000000
    const res = await request.get('/products?page=99999999999999999999');
    if (res.status() === 400) return;
    expect(Number.isSafeInteger((await res.json()).page)).toBe(true);
  });

  test('EX-04: known behaviour: a product deleted after page 1 was read moves the next one up, so page 2 skips one @regression', async ({ request }) => {
    const mine = `ex04-${run}`;
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await addOk(request, `item ${mine} ${i}`, mine));
    const page1 = await (await request.get(`/products?category=${mine}&limit=2&page=1`)).json();
    expect(page1.data.map((p: { id: number }) => p.id)).toEqual([ids[0], ids[1]]);

    expect((await request.delete(`/products/${ids[0]}`, { headers: auth() })).status()).toBe(204);
    const page2 = await (await request.get(`/products?category=${mine}&limit=2&page=2`)).json();
    // The client has seen ids[0] and ids[1]. The next unseen product is ids[2], but paging is by
    // position, so page 2 now starts at ids[3] and ids[2] is never shown.
    expect(page2.data.map((p: { id: number }) => p.id)).toEqual([ids[3], ids[4]]);
  });

  test('EX-05: a number is not accepted as a category @regression', async ({ request }) => {
    test.fail(); // bug: POST accepts category 5 with 201; the "" chip counts it and no filter can reach it
    const res = await add(request, `item ex05-${run}`, 5);
    expect(res.status()).toBe(400);
  });

  test('EX-06: an update cannot set a category that a create would refuse @regression', async ({ request }) => {
    test.fail(); // bug: PUT stores category null, "", " ", 5, ["a"], {"x":1} and true
    const mine = `ex06-${run}`;
    const id = await addOk(request, `item ${mine}`, mine);
    for (const category of [null, '', 5, ['a'], { x: 1 }, true]) {
      const res = await request.put(`/products/${id}`, { headers: auth(), data: { category } });
      expect(res.status(), JSON.stringify(category)).toBe(400);
    }
  });

  test('EX-08: known behaviour: a page past the last is an empty list, not an error @regression', async ({ request }) => {
    const mine = `ex08-${run}`;
    for (let i = 0; i < 3; i++) await addOk(request, `item ${mine} ${i}`, mine);
    const res = await request.get(`/products?category=${mine}&limit=2&page=9`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect([body.data, body.page, body.pages, body.total]).toEqual([[], 9, 2, 3]);
  });

  test('EX-09: updating a product does not move it in the list @regression', async ({ request }) => {
    const mine = `ex09-${run}`;
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push(await addOk(request, `item ${mine} ${i}`, mine));
    expect((await request.put(`/products/${ids[1]}`, { headers: auth(), data: { price: 99 } })).status()).toBe(200);
    const body = await (await request.get(`/products?category=${mine}`)).json();
    expect(body.data.map((p: { id: number }) => p.id)).toEqual(ids);
  });

  test('EX-10: known behaviour: category names are exact, so case and spaces make separate categories @regression', async ({ request }) => {
    const lower = `books-${run}`;
    const variants = [lower, lower.toUpperCase(), `${lower} `, ` ${lower}`];
    for (const v of variants) await addOk(request, `item ${v}`, v);
    for (const v of variants) {
      const body = await (await request.get(`/products?category=${encodeURIComponent(v)}`)).json();
      expect(body.total, JSON.stringify(v)).toBe(1);
    }
  });
});
