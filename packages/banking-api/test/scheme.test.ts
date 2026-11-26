import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { Ledger } from '../src/ledger.ts';
import { sqliteOnly, startApi, type Api, type Reply } from './helpers.ts';

// Payment scheme rules (BK-R38 to BK-R40): the reference a payment carries, the most
// one payment may be, and the most one account may send in a day. Each title starts
// with the rules it checks.

const DAY = '2026-11-22T12:00:00.000Z';
let clock = DAY;
const api = await startApi({ now: () => clock });
const count = (target: Api, table: string) => target.count(table);
const balance = async (id: number) => (await api.get(`/accounts/${id}`)).body.balance as string;

function refused(reply: Reply, status: number, code: string) {
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  assert.equal(reply.body.code, code);
  assert.equal(typeof reply.body.error, 'string');
}

async function funded(amount: string, currency = 'CAD', target: Api = api): Promise<number> {
  const id = await target.openAccount(currency);
  assert.equal((await target.post(`/accounts/${id}/deposits`, { amount, currency })).status, 201);
  return id;
}

const pay = (from: number, to: number, amount: string, currency = 'CAD', extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  api.request('POST', '/transfers', { from_account_id: from, to_account_id: to, amount, currency, ...extra }, headers);
const withdraw = (id: number, amount: string, currency = 'CAD', extra: Record<string, unknown> = {}) =>
  api.post(`/accounts/${id}/withdrawals`, { amount, currency, ...extra });

describe('the payment reference', () => {
  const ALL_CHARACTERS = "aZ09/-?:().,'+ Ab/-?:().,'+ 09"; // every allowed kind, spaces inside
  for (const [label, reference] of [
    ['1 character', 'A'],
    ['35 characters', 'R'.repeat(35)],
    ['every allowed kind of character, spaces inside', ALL_CHARACTERS.slice(0, 35)],
    ['a typical invoice number', 'INV/2026-11/0042 (final)'],
  ] as const) {
    test(`BK-R38 a reference of ${label} is kept and returned on the transfer, and on reading it back`, async () => {
      const from = await funded('100.00');
      const to = await api.openAccount('CAD');
      const made = await pay(from, to, '1.00', 'CAD', { reference });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      assert.equal(made.body.reference, reference);
      assert.equal((await api.get(`/transfers/${made.body.id}`)).body.reference, reference);
    });
  }

  test('BK-R38 a payment without a reference has reference null, also when it says null', async () => {
    const from = await funded('100.00');
    const to = await api.openAccount('CAD');
    assert.equal((await pay(from, to, '1.00')).body.reference, null);
    const explicit = await pay(from, to, '1.00', 'CAD', { reference: null });
    assert.equal(explicit.status, 201);
    assert.equal(explicit.body.reference, null);
  });

  for (const [label, reference] of [
    ['36 characters', 'R'.repeat(36)],
    ['empty', ''],
    ['only a space', ' '],
    ['a space at the start', ' INV-1'],
    ['a space at the end', 'INV-1 '],
    ['an accented letter', 'Café'],
    ['an emoji', 'paid 👍'],
    ['a line break', 'INV\n1'],
    ['a tab', 'INV\t1'],
    ['a hash sign', 'INV#1'],
    ['an ampersand', 'A&B'],
    ['a percent sign', '10%'],
    ['a semicolon', 'a;b'],
    ['an underscore', 'INV_1'],
    ['a number, not text', 12345],
    ['a list', ['INV-1']],
    ['an object', { id: 'INV-1' }],
  ] as const) {
    test(`BK-R38 BK-R16 a reference that is ${label} is refused with 400 invalid_reference and nothing is written`, async () => {
      const from = await funded('100.00');
      const to = await api.openAccount('CAD');
      const before = await count(api, 'transfers');
      refused(await pay(from, to, '1.00', 'CAD', { reference }), 400, 'invalid_reference');
      assert.equal(await count(api, 'transfers'), before);
      assert.equal(await balance(from), '100.00');
    });
  }

  test('BK-R38 deposits and withdrawals carry a reference too, with the same rule', async () => {
    const id = await api.openAccount('CAD');
    const deposit = await api.post(`/accounts/${id}/deposits`, { amount: '10.00', currency: 'CAD', reference: 'PAYROLL 11/2026' });
    assert.equal(deposit.status, 201);
    assert.equal(deposit.body.reference, 'PAYROLL 11/2026');
    assert.equal((await withdraw(id, '1.00', 'CAD', { reference: 'ATM-7' })).body.reference, 'ATM-7');
    refused(await api.post(`/accounts/${id}/deposits`, { amount: '1.00', currency: 'CAD', reference: 'no#good' }), 400, 'invalid_reference');
    refused(await withdraw(id, '1.00', 'CAD', { reference: 'no#good' }), 400, 'invalid_reference');
  });

  test('BK-R38 BK-R16 a bad reference is refused before the key is looked at', async () => {
    const from = await funded('100.00');
    const to = await api.openAccount('CAD');
    refused(await pay(from, to, '1.00', 'CAD', { reference: 'no#good' }, { 'Idempotency-Key': 'has a space' }), 400, 'invalid_reference');
  });

  test('BK-R38 BK-R20 BK-R21 a key repeats its reference: the same one replays, another is a mismatch', async () => {
    const from = await funded('100.00');
    const to = await api.openAccount('CAD');
    const key = { 'Idempotency-Key': `ref-${process.pid}-1` };
    const first = await pay(from, to, '5.00', 'CAD', { reference: 'INV-1' }, key);
    assert.equal(first.status, 201);
    const again = await pay(from, to, '5.00', 'CAD', { reference: 'INV-1' }, key);
    assert.equal(again.status, 201);
    assert.equal(again.headers.get('Idempotent-Replayed'), 'true');
    assert.deepEqual(again.body, first.body);
    assert.equal(again.body.reference, 'INV-1');
    refused(await pay(from, to, '5.00', 'CAD', { reference: 'INV-2' }, key), 422, 'idempotency_key_mismatch');
    refused(await pay(from, to, '5.00', 'CAD', {}, key), 422, 'idempotency_key_mismatch');
    assert.equal(await balance(from), '95.00');
  });
});

describe('a ledger file made before the reference existed', () => {
  test('BK-R38 opens as it was, gets the reference column, keeps its rows, and takes a reference after', sqliteOnly('a ledger file made before the column'), async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banking-old-'));
    const file = join(dir, 'old.db');
    try {
      // The schema as it was: no reference column on transfers.
      const old = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8').replace(/^ {2}reference .*\r?\n/m, '');
      assert.doesNotMatch(old, /reference\s+TEXT/);
      const raw = new DatabaseSync(file);
      raw.exec(old);
      raw.close();

      const first = new Ledger(file);
      const id = (await first.openAccount('Old File', 'CAD')).id;
      assert.equal((await first.deposit(id, 5000n, 'CAD')).ok, true);
      await first.close();

      const ledger = new Ledger(file); // opened again: the column exists already, nothing is added twice
      const made = await ledger.deposit(id, 100n, 'CAD');
      assert.equal(made.ok && made.value.reference, null);
      const withReference = await ledger.apply({ kind: 'deposit', from: null, to: id, amount: 100n, currency: 'CAD', reference: 'AFTER-1' });
      assert.equal(withReference.ok && withReference.value.reference, 'AFTER-1');
      assert.equal((await ledger.getAccount(id))!.balance, 5200n);
      assert.equal((await ledger.getTransfer(1))!.reference, null);
      await ledger.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The limits: one payment, then the day.
const LIMITS = [
  { currency: 'CAD', single: '10000.00', over: '10000.01', funds: '100000.00' },
  { currency: 'USD', single: '10000.00', over: '10000.01', funds: '100000.00' },
  { currency: 'JPY', single: '1000000', over: '1000001', funds: '10000000' },
  { currency: 'KWD', single: '3000.000', over: '3000.001', funds: '100000.000' },
] as const;

describe('the most one payment may be', () => {
  for (const { currency, single, over, funds } of LIMITS) {
    test(`BK-R39 ${currency}: ${single} may be sent, ${over} is refused with 422 payment_limit, as a transfer and as a withdrawal`, async () => {
      const from = await funded(funds, currency);
      const to = await api.openAccount(currency);
      const before = await balance(from);
      refused(await pay(from, to, over, currency), 422, 'payment_limit');
      refused(await withdraw(from, over, currency), 422, 'payment_limit');
      assert.equal(await balance(from), before);
      assert.equal((await pay(from, to, single, currency)).status, 201);
      const left = await withdraw(from, single, currency);
      assert.equal(left.status, 201, JSON.stringify(left.body));
    });
  }

  test('BK-R39 a refused payment writes nothing, and the message names the limit and the amount', async () => {
    const from = await funded('50000.00');
    const to = await api.openAccount('CAD');
    const before = await count(api, 'transfers');
    const reply = await pay(from, to, '10000.01');
    refused(reply, 422, 'payment_limit');
    assert.match(reply.body.error, /10000\.00/);
    assert.match(reply.body.error, /10000\.01/);
    assert.equal(await count(api, 'transfers'), before);
    assert.equal(await balance(from), '50000.00');
  });

  test('BK-R39 BK-R12 funds are checked first: a payment over the limit and over the balance is insufficient_funds', async () => {
    const from = await funded('5.00');
    const to = await api.openAccount('CAD');
    refused(await pay(from, to, '20000.00'), 422, 'insufficient_funds');
    refused(await withdraw(from, '20000.00'), 422, 'insufficient_funds');
  });

  test('BK-R39 a deposit is not a payment out: more than the limit may be deposited at once', async () => {
    const id = await api.openAccount('CAD');
    const reply = await api.post(`/accounts/${id}/deposits`, { amount: '10000.01', currency: 'CAD' });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.amount, '10000.01');
  });
});

describe('the most one account may send in a day', () => {
  test('BK-R40 withdrawals and transfers count together: 25,000.00 may go out in a day, one cent more may not', async () => {
    clock = '2026-11-23T09:00:00.000Z';
    const from = await funded('60000.00');
    const to = await api.openAccount('CAD');
    assert.equal((await pay(from, to, '10000.00')).status, 201);
    assert.equal((await withdraw(from, '10000.00')).status, 201);
    assert.equal((await pay(from, to, '4999.99')).status, 201);
    const refusal = await pay(from, to, '0.02');
    refused(refusal, 422, 'daily_limit');
    assert.match(refusal.body.error, /24999\.99/);
    refused(await withdraw(from, '0.02'), 422, 'daily_limit');
    assert.equal((await withdraw(from, '0.01')).status, 201); // exactly the limit
    refused(await withdraw(from, '0.01'), 422, 'daily_limit');
    assert.equal(await balance(from), '35000.00');
  });

  test('BK-R40 a payment refused for any reason does not use up the allowance', async () => {
    clock = '2026-11-24T09:00:00.000Z';
    const from = await funded('60000.00');
    const to = await api.openAccount('CAD');
    refused(await pay(from, to, '10000.01'), 422, 'payment_limit');
    refused(await pay(from, to, '1.00', 'USD'), 422, 'currency_mismatch');
    refused(await pay(from, from, '1.00'), 422, 'same_account');
    refused(await pay(from, to, '1.00', 'CAD', { reference: 'no#good' }), 400, 'invalid_reference');
    for (let i = 0; i < 2; i++) assert.equal((await pay(from, to, '10000.00')).status, 201);
    assert.equal((await pay(from, to, '5000.00')).status, 201); // all 25,000.00 still there
  });

  test('BK-R40 money received and deposited does not count: the receiver may send a full day too', async () => {
    clock = '2026-11-25T09:00:00.000Z';
    const sender = await funded('60000.00');
    const receiver = await funded('1.00'); // one dollar of its own, so the limit is what refuses
    for (let i = 0; i < 2; i++) assert.equal((await pay(sender, receiver, '10000.00')).status, 201);
    assert.equal((await pay(sender, receiver, '5000.00')).status, 201);
    refused(await pay(sender, receiver, '0.01'), 422, 'daily_limit');
    const other = await api.openAccount('CAD');
    for (let i = 0; i < 2; i++) assert.equal((await pay(receiver, other, '10000.00')).status, 201);
    assert.equal((await pay(receiver, other, '5000.00')).status, 201);
    refused(await pay(receiver, other, '0.01'), 422, 'daily_limit');
  });

  test('BK-R40 each account has its own allowance, and each currency its own limit', async () => {
    clock = '2026-11-26T09:00:00.000Z';
    const a = await funded('30000.00');
    const b = await funded('30000.00');
    const sink = await api.openAccount('CAD');
    for (const id of [a, b]) {
      for (let i = 0; i < 2; i++) assert.equal((await pay(id, sink, '10000.00')).status, 201);
      assert.equal((await pay(id, sink, '5000.00')).status, 201);
      refused(await pay(id, sink, '0.01'), 422, 'daily_limit');
    }
    const kwd = await funded('20000.000', 'KWD');
    const kwdSink = await api.openAccount('KWD');
    for (let i = 0; i < 2; i++) assert.equal((await pay(kwd, kwdSink, '3000.000', 'KWD')).status, 201);
    assert.equal((await pay(kwd, kwdSink, '1500.000', 'KWD')).status, 201);
    refused(await pay(kwd, kwdSink, '0.001', 'KWD'), 422, 'daily_limit');
  });

  test('BK-R40 the day is the UTC day: the last millisecond is still today, the next one is a new day', async () => {
    const from = await funded('100000.00');
    const to = await api.openAccount('CAD');
    clock = '2026-12-01T23:59:59.999Z';
    for (let i = 0; i < 2; i++) assert.equal((await pay(from, to, '10000.00')).status, 201);
    assert.equal((await pay(from, to, '5000.00')).status, 201);
    refused(await pay(from, to, '0.01'), 422, 'daily_limit');
    clock = '2026-12-02T00:00:00.000Z';
    assert.equal((await pay(from, to, '10000.00')).status, 201);
    clock = '2026-12-01T00:00:00.000Z'; // the earlier day, already used up
    refused(await pay(from, to, '0.01'), 422, 'daily_limit');
  });

  test('BK-R40 BK-R20 a replayed request is not sent twice, so it does not use the allowance twice', async () => {
    clock = '2026-12-03T09:00:00.000Z';
    const from = await funded('60000.00');
    const to = await api.openAccount('CAD');
    const key = { 'Idempotency-Key': `daily-${process.pid}-1` };
    assert.equal((await pay(from, to, '10000.00', 'CAD', {}, key)).status, 201);
    for (let i = 0; i < 3; i++) assert.equal((await pay(from, to, '10000.00', 'CAD', {}, key)).headers.get('Idempotent-Replayed'), 'true');
    assert.equal((await pay(from, to, '10000.00')).status, 201);
    assert.equal((await pay(from, to, '5000.00')).status, 201); // 25,000.00 in all, not 45,000.00
    refused(await pay(from, to, '0.01'), 422, 'daily_limit');
  });
});

describe('payments at the same time', () => {
  // The screening before a movement lets requests overlap; the limit is checked again
  // when the transfer is written (BK-R24), so only what fits goes through.
  test('BK-R40 BK-R24 three payments of 10,000.00 at once: two go through, one is refused with daily_limit', async () => {
    clock = '2026-12-04T09:00:00.000Z';
    const slow = await startApi({ now: () => clock, screen: () => sleep(100) });
    const from = await funded('100000.00', 'CAD', slow);
    const to = await slow.openAccount('CAD');
    const replies = await Promise.all([1, 2, 3].map(() =>
      slow.request('POST', '/transfers', { from_account_id: from, to_account_id: to, amount: '10000.00', currency: 'CAD' })));
    assert.deepEqual(replies.map((r) => r.status).sort(), [201, 201, 422]);
    assert.equal(replies.find((r) => r.status === 422)!.body.code, 'daily_limit');
    assert.equal((await slow.get(`/accounts/${from}`)).body.balance, '80000.00');
  });
});
