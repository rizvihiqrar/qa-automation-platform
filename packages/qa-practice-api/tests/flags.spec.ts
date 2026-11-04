import { test, expect } from '@playwright/test';
import { parseFlags, DEFAULTS } from '../src/flags.ts';
import { startServer, startFailing, type Started } from './start-server.ts';
import { ADMIN, PASSWORD } from './admin.ts';

// Feature flags (src/flags.ts): one flag today, discount-codes, on by default. They are read
// at start-up, so the server-level cases start a copy of the API with FEATURE_FLAGS set
// (tests/start-server.ts); the suite's own server is never switched.

test.describe('reading FEATURE_FLAGS', () => {
  test('FL-01 with nothing set every flag has its default, and discount codes are on @regression', () => {
    expect(parseFlags(undefined)).toEqual(DEFAULTS);
    expect(parseFlags('')).toEqual(DEFAULTS);
    expect(DEFAULTS['discount-codes']).toBe(true);
  });

  test('FL-02 name:off switches a flag off and name:on keeps it on @regression', () => {
    expect(parseFlags('discount-codes:off')['discount-codes']).toBe(false);
    expect(parseFlags('discount-codes:on')['discount-codes']).toBe(true);
  });

  test('FL-03 spaces and empty entries around the list change nothing @regression', () => {
    expect(parseFlags(' discount-codes : off ,, ')['discount-codes']).toBe(false);
  });

  test('FL-04 an unknown flag is ignored with a warning that names it and lists the known ones @regression', () => {
    const warnings: string[] = [];
    const flags = parseFlags('new-checkout:on,discount-codes:off', (m) => warnings.push(m));
    expect(flags).toEqual({ 'discount-codes': false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"new-checkout"');
    expect(warnings[0]).toContain('discount-codes');
  });

  test('FL-05 a value other than on or off stops the start and names the flag and the value @regression', () => {
    for (const bad of ['true', 'ON', 'of', '1', '']) {
      expect(() => parseFlags(`discount-codes:${bad}`), `value "${bad}"`).toThrow(`discount-codes must be on or off, not "${bad}"`);
    }
  });

  test('FL-06 an entry that is not name:value stops the start @regression', () => {
    for (const bad of ['discount-codes', ':off', 'discount-codes:off:on']) {
      expect(() => parseFlags(bad), bad).toThrow(/is not name:on or name:off/);
    }
  });

  test('FL-07 a flag listed twice stops the start, rather than the last one quietly winning @regression', () => {
    expect(() => parseFlags('discount-codes:off,discount-codes:on')).toThrow('discount-codes is listed twice');
  });

  test('FL-08 flag names are case sensitive: Discount-Codes is not discount-codes @regression', () => {
    const warnings: string[] = [];
    expect(parseFlags('Discount-Codes:off', (m) => warnings.push(m))['discount-codes']).toBe(true);
    expect(warnings).toHaveLength(1);
  });
});

// A shopper, a product and a 10% code on a server of its own; returns what each case needs.
async function shop(server: Started) {
  const post = async (path: string, body: unknown, token?: string) => {
    const res = await fetch(`${server.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const adminToken = (await post('/auth/login', { email: ADMIN.email, password: ADMIN.password })).body.token;
  const product = (await post('/products', { name: 'Flag Widget', category: 'flags', price: 10, stock: 5 }, adminToken)).body;
  await post('/discounts', { code: 'TENOFF', type: 'percent', value: 10 }, adminToken);
  const email = `flags.${Date.now()}@example.com`;
  const customer = (await post('/auth/register', { name: 'Flag Tester', email, password: PASSWORD })).body.token;
  const order = (discount_code?: unknown) => post('/orders', { items: [{ product_id: product.id, quantity: 1 }], ...(discount_code === undefined ? {} : { discount_code }) }, customer);
  const stock = async () => (await (await fetch(`${server.url}/products/${product.id}`)).json()).stock;
  return { order, stock };
}

test.describe('the discount-codes flag on a running server', () => {
  let server: Started;
  test.afterEach(() => server?.stop());

  test('FL-09 started with no flags, an order with a code gets its discount @regression', async () => {
    server = await startServer();
    const { order } = await shop(server);
    const res = await order('TENOFF');
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(9);
  });

  test('FL-10 started with discount-codes:on, it behaves as it does with no flags @regression', async () => {
    server = await startServer({ FEATURE_FLAGS: 'discount-codes:on' });
    const res = await (await shop(server)).order('TENOFF');
    expect(res.status).toBe(201);
    expect(res.body.discount_code).toBe('TENOFF');
  });

  test('FL-11 started with discount-codes:off, an order that names a code is refused with a 400 that says why, and nothing is taken from stock @regression', async () => {
    server = await startServer({ FEATURE_FLAGS: 'discount-codes:off' });
    const { order, stock } = await shop(server);
    const res = await order('TENOFF');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Discount codes are switched off' });
    expect(await stock()).toBe(5);
  });

  test('FL-12 with discount-codes off, orders without a code still work, at full price, and so does an explicit null @regression', async () => {
    server = await startServer({ FEATURE_FLAGS: 'discount-codes:off' });
    const { order, stock } = await shop(server);
    for (const code of [undefined, null]) {
      const res = await order(code);
      expect(res.status, `discount_code ${code}`).toBe(201);
      expect(res.body.total).toBe(10);
    }
    expect(await stock()).toBe(3);
  });

  test('FL-13 with discount-codes off, a code that is blank or not a string still gets the existing 400 about the code, not the switched-off message @regression', async () => {
    server = await startServer({ FEATURE_FLAGS: 'discount-codes:off' });
    const { order } = await shop(server);
    // The flag check comes after the existing validation, so that answer does not change.
    expect((await order('   ')).status).toBe(400);
    expect((await order(5)).body.error).toMatch(/discount_code must be a non-empty string or null/);
  });

  test('FL-14 with discount-codes off the code routes still work for the admin: the flag stops using a code, not managing them @regression', async () => {
    server = await startServer({ FEATURE_FLAGS: 'discount-codes:off' });
    await shop(server); // creates TENOFF through POST /discounts
    const login = await fetch(`${server.url}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }) });
    const token = (await login.json()).token;
    const res = await fetch(`${server.url}/discounts/TENOFF`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  test('FL-15 an unknown flag does not stop the start: the server runs, the flag has no effect, and its log says it was ignored @regression', async () => {
    server = await startServer({ FEATURE_FLAGS: 'new-checkout:on' });
    expect(server.log()).toContain('unknown flag "new-checkout" ignored');
    expect((await (await shop(server)).order('TENOFF')).status).toBe(201);
  });
});

test.describe('a bad FEATURE_FLAGS setting', () => {
  test('FL-16 a value that is not on or off stops the server at start-up with a message that names the problem @regression', async () => {
    const { code, output } = await startFailing({ FEATURE_FLAGS: 'discount-codes:maybe' });
    expect(code).not.toBe(0);
    expect(code).not.toBeNull(); // it stopped; it did not keep running
    expect(output).toContain('discount-codes must be on or off, not "maybe"');
  });
});
