// Properties of discount codes themselves (Day 39 of docs/ai-written-code): expiry
// dates against a calendar written separately here, and a model of uses that
// random sequences of orders, cancellations and admin changes must agree with.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { startApi, type Api } from './harness.ts';

let api: Api;
let product: number;
let shoppers: { id: number; token: string }[] = [];
let codes = 0;
before(async () => {
  api = await startApi();
  product = await api.product(10);
  for (let i = 0; i < 3; i++) shoppers.push(await api.customer());
});
after(() => api.close());

const shopper = (i: number) => {
  const s = shoppers[i];
  if (!s) throw new Error(`no shopper ${i}`);
  return s;
};
const uniqueCode = () => `C${process.pid}-${++codes}`.slice(0, 20);
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

// The Gregorian calendar, written from its rule rather than from Date.
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;

test('DC-PR-11 [DC-R05] expires_at is accepted exactly when it is a real future date-time', async () => {
  const stamp = fc.record({
    y: fc.oneof(fc.integer({ min: 2027, max: 2500 }), fc.constantFrom(2100, 2200, 2300, 2400, 2028, 2032)),
    mo: fc.integer({ min: 0, max: 13 }),
    d: fc.oneof(fc.integer({ min: 0, max: 32 }), fc.constantFrom(28, 29, 30, 31)),
    h: fc.integer({ min: 0, max: 24 }),
    mi: fc.integer({ min: 0, max: 60 }),
    s: fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }),
    ms: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
    zone: fc.oneof(fc.constant('Z'), fc.record({ sign: fc.constantFrom('+', '-'), h: fc.integer({ min: 0, max: 14 }), m: fc.constantFrom(0, 30, 45) })),
  });
  await fc.assert(fc.asyncProperty(stamp, async (t) => {
    const zone = t.zone === 'Z' ? 'Z' : `${t.zone.sign}${pad(t.zone.h)}:${pad(t.zone.m)}`;
    const seconds = t.s === undefined ? '' : `:${pad(t.s)}${t.ms === undefined ? '' : `.${pad(t.ms, 3)}`}`;
    const text = `${t.y}-${pad(t.mo)}-${pad(t.d)}T${pad(t.h)}:${pad(t.mi)}${seconds}${zone}`;
    const real = t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= daysIn(t.y, t.mo)
      && t.h <= 23 && t.mi <= 59 && (t.s ?? 0) <= 59;
    // Every year here is after today, so a real date is always in the future.
    const res = await api.call('POST', '/discounts', { code: uniqueCode(), type: 'percent', value: 5, expires_at: text }, api.admin);
    assert.equal(res.status, real ? 201 : 400, `${text}: ${JSON.stringify(res.body)}`);
    if (real) assert.equal(res.body.expires_at, text);
  }), { numRuns: 1000 });
});

// Finding PM-02: the AI's two-decimal check (n * 100 within 1e-9 of a whole number)
// was too loose for small amounts (CR-02) and too strict for large ones: from
// 131,072.02 up, n * 100 carries more float error than 1e-9, so about 9% of valid
// amounts were refused. No boundary in the spec points there.
test('DC-PR-13 [DC-R04, DC-R07] any whole-cent fixed value and minimum up to 999,999,999.99 is accepted', async () => {
  const amount = fc.bigInt({ min: 1n, max: 99_999_999_999n }).map((c) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`);
  await fc.assert(fc.asyncProperty(amount, amount, async (value, min) => {
    const res = await api.call('POST', '/discounts', { code: uniqueCode(), type: 'fixed', value: JSON.parse(value), min_subtotal: JSON.parse(min) }, api.admin);
    assert.equal(res.status, 201, `value ${value}, min_subtotal ${min}: ${JSON.stringify(res.body)}`);
    assert.deepEqual([res.body.value, res.body.min_subtotal], [JSON.parse(value), JSON.parse(min)]);
  }), { numRuns: 500 });
});

// Mutation testing (Day 39) found refusals whose message could be emptied, or whose
// body could lose `error` altogether, with every test still passing: the tests
// checked the status code only. And a list such as ["2027-01-01T00:00:00Z"] reads
// as its text in a pattern test, so only the type check stands between it and a
// crash. These two send any JSON value in any field and accept only a success or
// a refusal with a message.
const refusedWithMessage = (res: { status: number; body: any }, okStatus: number, what: string) => {
  if (res.status === okStatus) return;
  assert.ok([400, 404, 409].includes(res.status), `${what}: status ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(typeof res.body.error, 'string', `${what}: no error message`);
  assert.ok(res.body.error.length > 0, `${what}: empty error message`);
};

// Valid values for each field, a list or object wrapping one, or any JSON value.
const valid: Record<string, unknown[]> = {
  code: ['SUMMER10'],
  type: ['percent', 'fixed'],
  value: [10, 19.99],
  expires_at: ['2027-01-01T00:00:00Z', null],
  max_uses: [5, null],
  min_subtotal: [0, 50],
  active: [true, false],
};
const anyValueFor = (field: string) => fc.oneof(
  fc.constantFrom(...(valid[field] ?? [null])),
  fc.constantFrom(...(valid[field] ?? [null])).map((v) => [v]),
  fc.constantFrom(...(valid[field] ?? [null])).map((v) => ({ value: v })),
  fc.jsonValue({ maxDepth: 2 }),
);

test('DC-PR-14 [DC-R01, DC-R03, DC-R04, DC-R05, DC-R06, DC-R07, DC-R08, DC-R10] creating a code with any value in any field: 201, or a refusal with a message', async () => {
  const fields = Object.keys(valid);
  const body = fc.constantFrom(...fields).chain((field) => anyValueFor(field).map((value) => ({ field, value })));
  await fc.assert(fc.asyncProperty(body, async ({ field, value }) => {
    const sent = { code: uniqueCode(), type: 'percent', value: 10, [field]: field === 'code' && typeof value === 'string' ? `${value}${codes}` : value };
    refusedWithMessage(await api.call('POST', '/discounts', sent, api.admin), 201, `${field} = ${JSON.stringify(value)}`);
  }), { numRuns: 500 });
  // A duplicate, and an unknown code on GET and PATCH.
  const code = uniqueCode();
  await api.call('POST', '/discounts', { code, type: 'percent', value: 10 }, api.admin);
  refusedWithMessage(await api.call('POST', '/discounts', { code, type: 'percent', value: 10 }, api.admin), 201, 'duplicate');
  refusedWithMessage(await api.call('GET', '/discounts/NO-SUCH-CODE', undefined, api.admin), 200, 'GET unknown');
  refusedWithMessage(await api.call('PATCH', '/discounts/NO-SUCH-CODE', {}, api.admin), 200, 'PATCH unknown');
});

test('DC-PR-15 [DC-R11] changing a code with any body: 200, or a refusal with a message', async () => {
  const code = uniqueCode();
  await api.call('POST', '/discounts', { code, type: 'percent', value: 10 }, api.admin);
  const key = fc.constantFrom('active', 'expires_at', 'max_uses', 'value', 'code', 'type', 'min_subtotal', 'uses', 'other');
  const patch = fc.oneof(
    fc.dictionary(key, fc.jsonValue({ maxDepth: 2 }), { maxKeys: 3 }),
    fc.dictionary(key, key.chain(anyValueFor), { maxKeys: 3 }),
    fc.jsonValue({ maxDepth: 2 }),
  );
  await fc.assert(fc.asyncProperty(patch, async (body) => {
    // Turn it back on and lift any limit first, so each body starts from the same code.
    await api.call('PATCH', `/discounts/${code}`, { active: true, max_uses: null, expires_at: null }, api.admin);
    refusedWithMessage(await api.call('PATCH', `/discounts/${code}`, body, api.admin), 200, JSON.stringify(body));
  }), { numRuns: 500 });
});

// Two more gaps from mutation testing. `uses` counts orders through a store query
// with a page size; dropping it (the store's default page is 10) left every test
// green, because none used a code more than 10 times. And treating every code with
// an expiry date as expired went unnoticed: no test ordered with a code that expires.
test('DC-PR-16 [DC-R06, DC-R21] uses keep counting past 10: max_uses of 11 to 14 allows exactly that many orders', async () => {
  const crowd: { id: number; token: string }[] = [];
  for (let i = 0; i < 15; i++) crowd.push(await api.customer());
  await fc.assert(fc.asyncProperty(fc.integer({ min: 11, max: 14 }), async (max) => {
    const made = await api.call('POST', '/discounts', { code: uniqueCode(), type: 'percent', value: 10, max_uses: max }, api.admin);
    const statuses = [];
    for (const c of crowd.slice(0, max + 1)) {
      statuses.push((await api.call('POST', '/orders', { items: [{ product_id: product, quantity: 1 }], discount_code: made.body.code }, c.token)).status);
    }
    assert.deepEqual(statuses, [...Array(max).fill(201), 422], `max_uses ${max}`);
    assert.equal((await api.call('GET', `/discounts/${made.body.code}`, undefined, api.admin)).body.uses, max);
  }), { numRuns: 4 });
});

test('DC-PR-17 [DC-R05, DC-R15] a code that expires any time in the future can be used now', async () => {
  const ahead = fc.integer({ min: 60_000, max: 50 * 365 * 24 * 3600_000 }); // a minute to 50 years
  await fc.assert(fc.asyncProperty(ahead, async (ms) => {
    const made = await api.call('POST', '/discounts', { code: uniqueCode(), type: 'percent', value: 10, expires_at: new Date(Date.now() + ms).toISOString() }, api.admin);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const res = await api.call('POST', '/orders', { items: [{ product_id: product, quantity: 1 }], discount_code: made.body.code }, shopper(0).token);
    assert.equal(res.status, 201, `expires in ${ms} ms: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.discount, 1);
  }), { numRuns: 50 });
});

// The model: what the spec says the code's state is after each step (DC-R11, DC-R15,
// DC-R21 to DC-R23). Each command changes the model and the API, then compares.
interface Model { active: boolean; maxUses: number | null; counting: Map<number, number> } // shopper → order id
interface Real { code: string }
type Cmd = fc.AsyncCommand<Model, Real>;

const uses = (m: Model) => m.counting.size;

async function checkUses(m: Model, r: Real) {
  const res = await api.call('GET', `/discounts/${r.code}`, undefined, api.admin);
  assert.equal(res.body.uses, uses(m), 'uses');
  if (m.maxUses !== null) assert.ok(res.body.uses <= m.maxUses, `uses ${res.body.uses} over max_uses ${m.maxUses}`);
}

class Place implements Cmd {
  readonly who: number;
  constructor(who: number) { this.who = who; }
  check = () => true;
  async run(m: Model, r: Real) {
    const s = shopper(this.who);
    const res = await api.call('POST', '/orders', { items: [{ product_id: product, quantity: 1 }], discount_code: r.code.toLowerCase() }, s.token);
    // DC-R15's order of refusals.
    const expected = !m.active ? 'Discount code is not valid'
      : m.maxUses !== null && uses(m) >= m.maxUses ? 'Discount code has reached its usage limit'
      : m.counting.has(this.who) ? 'You have already used this discount code'
      : null;
    if (expected) {
      assert.deepEqual([res.status, res.body.error], [422, expected], this.toString());
    } else {
      assert.equal(res.status, 201, `${this}: ${JSON.stringify(res.body)}`);
      m.counting.set(this.who, res.body.id);
    }
    await checkUses(m, r);
  }
  toString = () => `place(shopper ${this.who})`;
}

class Cancel implements Cmd {
  readonly who: number;
  constructor(who: number) { this.who = who; }
  check = (m: Readonly<Model>) => m.counting.has(this.who);
  async run(m: Model, r: Real) {
    const res = await api.call('PATCH', `/orders/${m.counting.get(this.who)}/status`, { status: 'cancelled' }, shopper(this.who).token);
    assert.equal(res.status, 200, `${this}: ${JSON.stringify(res.body)}`);
    m.counting.delete(this.who);
    await checkUses(m, r);
  }
  toString = () => `cancel(shopper ${this.who})`;
}

class SetMaxUses implements Cmd {
  readonly to: number | null;
  constructor(to: number | null) { this.to = to; }
  check = () => true;
  async run(m: Model, r: Real) {
    const res = await api.call('PATCH', `/discounts/${r.code}`, { max_uses: this.to }, api.admin);
    if (this.to !== null && this.to < uses(m)) {
      assert.equal(res.status, 409, this.toString());
    } else {
      assert.equal(res.status, 200, `${this}: ${JSON.stringify(res.body)}`);
      m.maxUses = this.to;
    }
    await checkUses(m, r);
  }
  toString = () => `max_uses = ${this.to}`;
}

class SetActive implements Cmd {
  readonly to: boolean;
  constructor(to: boolean) { this.to = to; }
  check = () => true;
  async run(m: Model, r: Real) {
    const res = await api.call('PATCH', `/discounts/${r.code}`, { active: this.to }, api.admin);
    assert.equal(res.status, 200, this.toString());
    m.active = this.to;
    await checkUses(m, r);
  }
  toString = () => `active = ${this.to}`;
}

test('DC-PR-12 [DC-R11, DC-R15, DC-R21, DC-R22, DC-R23] uses follow a model through any sequence of orders, cancels and changes', async () => {
  const who = fc.integer({ min: 0, max: 2 });
  const commands = fc.commands([
    who.map((w) => new Place(w)),
    who.map((w) => new Place(w)),
    who.map((w) => new Cancel(w)),
    fc.option(fc.integer({ min: 1, max: 3 }), { nil: null }).map((n) => new SetMaxUses(n)),
    fc.boolean().map((b) => new SetActive(b)),
  ], { maxCommands: 20 });
  const start = fc.record({ maxUses: fc.option(fc.integer({ min: 1, max: 3 }), { nil: null }) });

  await fc.assert(fc.asyncProperty(start, commands, async ({ maxUses }, cmds) => {
    const code = uniqueCode();
    const made = await api.call('POST', '/discounts', { code, type: 'percent', value: 10, max_uses: maxUses }, api.admin);
    assert.equal(made.status, 201);
    await fc.asyncModelRun(() => ({ model: { active: true, maxUses, counting: new Map() }, real: { code: made.body.code } }), cmds);
  }), { numRuns: 150 });
});
