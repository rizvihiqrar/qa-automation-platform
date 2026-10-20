import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { startApi } from './helpers.ts';

// Designed cases against the running API. Each title starts with the rules it checks.

const api = await startApi();

const deposit = (id: number, amount: unknown, currency = 'CAD') => api.post(`/accounts/${id}/deposits`, { amount, currency });
const withdraw = (id: number, amount: unknown, currency = 'CAD') => api.post(`/accounts/${id}/withdrawals`, { amount, currency });
const transfer = (from: unknown, to: unknown, amount: unknown, currency = 'CAD') =>
  api.post('/transfers', { from_account_id: from, to_account_id: to, amount, currency });
const balance = async (id: number) => (await api.get(`/accounts/${id}`)).body.balance as string;
const entryCount = async (id: number) => (await api.get(`/accounts/${id}/entries`)).body.entries.length as number;

function refused(reply: { status: number; body: any }, status: number, code: string) {
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  assert.equal(reply.body.code, code);
  assert.equal(typeof reply.body.error, 'string');
  assert.ok(reply.body.error.length > 0);
}

describe('accounts', () => {
  test('BK-R08 BK-R07 BK-R18 opening a CAD account answers 201 with a zero balance, "0.00"', async () => {
    const reply = await api.post('/accounts', { owner: 'Ada', currency: 'CAD' });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.owner, 'Ada');
    assert.equal(reply.body.currency, 'CAD');
    assert.equal(reply.body.balance, '0.00');
    assert.ok(Number.isSafeInteger(reply.body.id) && reply.body.id > 0);
    assert.match(reply.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(reply.headers.get('cache-control'), 'no-store');
    assert.equal(reply.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual((await api.get(`/accounts/${reply.body.id}`)).body, reply.body);
  });

  test('BK-R07 BK-R08 a zero balance has the currency\'s decimals: JPY "0", KWD "0.000"', async () => {
    assert.equal(await balance(await api.openAccount('JPY')), '0');
    assert.equal(await balance(await api.openAccount('KWD')), '0.000');
  });

  test('BK-R08 the owner is trimmed; 100 characters are accepted', async () => {
    assert.equal((await api.post('/accounts', { owner: '  Grace  ', currency: 'USD' })).body.owner, 'Grace');
    assert.equal((await api.post('/accounts', { owner: 'x'.repeat(100), currency: 'USD' })).status, 201);
  });

  for (const owner of [undefined, '', '   ', 'x'.repeat(101), 42, ['Ada']]) {
    test(`BK-R08 BK-R16 owner ${JSON.stringify(owner) ?? 'missing'} is refused with 400 invalid_owner`, async () => {
      refused(await api.post('/accounts', { owner, currency: 'CAD' }), 400, 'invalid_owner');
    });
  }

  for (const currency of [undefined, 'cad', 'EUR', ' CAD', 1, 'toString', '__proto__']) {
    test(`BK-R08 BK-R16 currency ${JSON.stringify(currency) ?? 'missing'} is refused with 400 invalid_currency`, async () => {
      refused(await api.post('/accounts', { owner: 'Ada', currency }), 400, 'invalid_currency');
    });
  }
});

describe('deposits and withdrawals', () => {
  test('BK-R07 BK-R09 BK-R13 a deposit of "5" CAD is "5.00", and the balance is the sum of the entries', async () => {
    const id = await api.openAccount('CAD');
    const reply = await deposit(id, '5');
    assert.equal(reply.status, 201);
    assert.equal(reply.body.kind, 'deposit');
    assert.equal(reply.body.amount, '5.00');
    assert.equal(reply.body.to_account_id, id);
    assert.equal(await balance(id), '5.00');
  });

  test('BK-R04 three deposits of "0.10" make exactly "0.30" (0.1 + 0.1 + 0.1 is 0.30000000000000004 as doubles)', async () => {
    const id = await api.openAccount('CAD');
    for (let i = 0; i < 3; i++) await deposit(id, '0.10');
    assert.equal(await balance(id), '0.30');
  });

  test('BK-R04 BK-R06 amounts above 2^53 minor units stay exact: 90071992547409.93 + 0.01', async () => {
    const id = await api.openAccount('USD');
    assert.equal((await deposit(id, '90071992547409.93', 'USD')).body.amount, '90071992547409.93');
    await deposit(id, '0.01', 'USD');
    assert.equal(await balance(id), '90071992547409.94');
  });

  test('BK-R02 BK-R07 KWD keeps three decimals and JPY none', async () => {
    const kwd = await api.openAccount('KWD');
    assert.equal((await deposit(kwd, '1.234', 'KWD')).body.amount, '1.234');
    assert.equal((await deposit(kwd, '2', 'KWD')).body.amount, '2.000');
    assert.equal(await balance(kwd), '3.234');
    const jpy = await api.openAccount('JPY');
    refused(await deposit(jpy, '1.0', 'JPY'), 400, 'invalid_amount');
    assert.equal((await deposit(jpy, '1500', 'JPY')).body.amount, '1500');
  });

  for (const amount of [5, 5.5, '5.001', '-5.00', '1e2', '0', '0.00', null]) {
    test(`BK-R01 BK-R02 BK-R03 BK-R05 BK-R16 a deposit of ${JSON.stringify(amount)} is refused with 400 and nothing is written`, async () => {
      const id = await api.openAccount('CAD');
      refused(await deposit(id, amount), 400, 'invalid_amount');
      assert.equal(await entryCount(id), 0);
    });
  }

  test('BK-R10 a deposit in another currency than the account\'s is refused: 422 currency_mismatch', async () => {
    const id = await api.openAccount('CAD');
    refused(await deposit(id, '5.00', 'USD'), 422, 'currency_mismatch');
    assert.equal(await balance(id), '0.00');
  });

  test('BK-R12 withdrawing the whole balance is allowed; one cent more is refused and writes nothing', async () => {
    const id = await api.openAccount('CAD');
    await deposit(id, '10.00');
    refused(await withdraw(id, '10.01'), 422, 'insufficient_funds');
    assert.equal(await entryCount(id), 1);
    const reply = await withdraw(id, '10.00');
    assert.equal(reply.status, 201);
    assert.equal(reply.body.kind, 'withdrawal');
    assert.equal(reply.body.from_account_id, id);
    assert.equal(reply.body.to_account_id, null);
    assert.equal(await balance(id), '0.00');
    refused(await withdraw(id, '0.01'), 422, 'insufficient_funds');
  });

  test('BK-R12 the refusal names the balance and the amount', async () => {
    const id = await api.openAccount('CAD');
    await deposit(id, '3.50');
    const reply = await withdraw(id, '3.51');
    assert.match(reply.body.error, /balance is 3\.50, amount is 3\.51/);
  });

  test('BK-R16 a deposit to an unknown account is 404, but only once the request itself is valid', async () => {
    refused(await deposit(999_999, '5.00'), 404, 'not_found');
    refused(await deposit(999_999, 5), 400, 'invalid_amount');
    refused(await deposit(999_999, '5.00', 'EUR'), 400, 'invalid_currency');
  });
});

describe('transfers', () => {
  test('BK-R10 BK-R13 a transfer moves the amount: one debit, one credit, the same amount', async () => {
    const from = await api.openAccount('CAD');
    const to = await api.openAccount('CAD');
    await deposit(from, '100.00');
    const reply = await transfer(from, to, '40.25');
    assert.equal(reply.status, 201);
    assert.deepEqual(
      { kind: reply.body.kind, from: reply.body.from_account_id, to: reply.body.to_account_id, amount: reply.body.amount, currency: reply.body.currency },
      { kind: 'transfer', from, to, amount: '40.25', currency: 'CAD' },
    );
    assert.equal(await balance(from), '59.75');
    assert.equal(await balance(to), '40.25');
    const stored = await api.get(`/transfers/${reply.body.id}`);
    assert.equal(stored.status, 200);
    assert.deepEqual(stored.body.entries, [{ account_id: from, amount: '-40.25' }, { account_id: to, amount: '40.25' }]);
  });

  test('BK-R12 transferring the whole balance is allowed; one cent more is refused and writes nothing', async () => {
    const from = await api.openAccount('CAD');
    const to = await api.openAccount('CAD');
    await deposit(from, '20.00');
    refused(await transfer(from, to, '20.01'), 422, 'insufficient_funds');
    assert.deepEqual([await entryCount(from), await entryCount(to)], [1, 0]);
    assert.equal((await transfer(from, to, '20.00')).status, 201);
    assert.deepEqual([await balance(from), await balance(to)], ['0.00', '20.00']);
  });

  test('BK-R11 a transfer from an account to itself is refused: 422 same_account', async () => {
    const id = await api.openAccount('CAD');
    await deposit(id, '5.00');
    refused(await transfer(id, id, '1.00'), 422, 'same_account');
    assert.equal(await entryCount(id), 1);
  });

  test('BK-R10 a transfer between currencies is refused, whichever side differs', async () => {
    const cad = await api.openAccount('CAD');
    const usd = await api.openAccount('USD');
    const cad2 = await api.openAccount('CAD');
    await deposit(cad, '50.00');
    refused(await transfer(cad, usd, '1.00', 'CAD'), 422, 'currency_mismatch');
    refused(await transfer(cad, usd, '1.00', 'USD'), 422, 'currency_mismatch');
    refused(await transfer(cad, cad2, '1.00', 'USD'), 422, 'currency_mismatch');
    assert.deepEqual([await balance(cad), await balance(usd), await balance(cad2)], ['50.00', '0.00', '0.00']);
  });

  test('BK-R16 refusal order: request, then accounts, then the bank\'s rules', async () => {
    const a = await api.openAccount('CAD');
    const usd = await api.openAccount('USD');
    // a bad amount to an unknown account: the request is read first
    refused(await transfer(a, 999_999, '1.001'), 400, 'invalid_amount');
    // an unknown account with no funds: existence before funds
    refused(await transfer(a, 999_999, '1.00'), 404, 'not_found');
    refused(await transfer(999_999, a, '1.00'), 404, 'not_found');
    // to itself in the wrong currency: same_account before currency
    refused(await transfer(a, a, '1.00', 'USD'), 422, 'same_account');
    // the wrong currency with no funds: currency before funds
    refused(await transfer(a, usd, '1.00'), 422, 'currency_mismatch');
  });

  for (const [label, value] of [['missing', undefined], ['a string', '1'], ['zero', 0], ['negative', -1], ['a fraction', 1.5], ['too large', 2 ** 53]] as const) {
    test(`BK-R17 BK-R16 from_account_id ${label} is refused with 400 invalid_account_id`, async () => {
      const to = await api.openAccount('CAD');
      refused(await transfer(value, to, '1.00'), 400, 'invalid_account_id');
      refused(await transfer(to, value, '1.00'), 400, 'invalid_account_id');
    });
  }

  test('BK-R17 an unknown transfer id is 404', async () => {
    refused(await api.get('/transfers/999999'), 404, 'not_found');
  });
});

describe('the funding accounts and the statement', () => {
  test('BK-R14 deposits and withdrawals show null for the funding side, and its account is not found', async () => {
    // Its own server, so this deposit is the first in KWD and creates the funding account.
    const own = await startApi();
    const before = await own.openAccount('KWD');
    const made = await own.post(`/accounts/${before}/deposits`, { amount: '1.000', currency: 'KWD' });
    const after = await own.openAccount('KWD');
    const stored = await own.get(`/transfers/${made.body.id}`);
    assert.equal(stored.body.from_account_id, null);
    assert.deepEqual(stored.body.entries, [{ account_id: null, amount: '-1.000' }, { account_id: before, amount: '1.000' }]);
    // The funding account was created by the first KWD deposit, so its id lies
    // between the two customer accounts, and the API must not show it.
    const between = Array.from({ length: after - before - 1 }, (_, i) => before + 1 + i);
    assert.equal(between.length, 1);
    for (const id of between) refused(await own.get(`/accounts/${id}`), 404, 'not_found');
  });

  test('BK-R15 BK-R09 the statement runs oldest first with the balance after each entry', async () => {
    const a = await api.openAccount('CAD');
    const b = await api.openAccount('CAD');
    await deposit(a, '100.00');
    await transfer(a, b, '30.00');
    await deposit(b, '5.00');
    await transfer(b, a, '12.34');
    await withdraw(a, '0.01');
    const reply = await api.get(`/accounts/${a}/entries`);
    assert.equal(reply.status, 200);
    const rows = reply.body.entries.map((e: any) => [e.kind, e.counterparty_account_id, e.amount, e.balance_after]);
    assert.deepEqual(rows, [
      ['deposit', null, '100.00', '100.00'],
      ['transfer', b, '-30.00', '70.00'],
      ['transfer', b, '12.34', '82.34'],
      ['withdrawal', null, '-0.01', '82.33'],
    ]);
    assert.equal(reply.body.balance, '82.33');
    assert.equal(reply.body.entries.at(-1).balance_after, reply.body.balance);
  });

  test('BK-R15 a new account has an empty statement', async () => {
    const id = await api.openAccount('JPY');
    const reply = await api.get(`/accounts/${id}/entries`);
    assert.deepEqual([reply.body.balance, reply.body.entries], ['0', []]);
  });
});

describe('the limit on money in one currency', () => {
  // Its own server: the limit counts every account in the currency.
  test('BK-R06 the limit counts all accounts together, per currency, and frees up after a withdrawal', async () => {
    const own = await startApi();
    const a = await own.openAccount('JPY');
    const b = await own.openAccount('JPY');
    const usd = await own.openAccount('USD');
    assert.equal((await own.post(`/accounts/${a}/deposits`, { amount: '99999999999999998', currency: 'JPY' })).status, 201);
    assert.equal((await own.post(`/accounts/${b}/deposits`, { amount: '1', currency: 'JPY' })).status, 201);
    refused(await own.post(`/accounts/${b}/deposits`, { amount: '1', currency: 'JPY' }), 422, 'limit_exceeded');
    assert.equal((await own.post(`/accounts/${usd}/deposits`, { amount: '1.00', currency: 'USD' })).status, 201);
    assert.equal((await own.post(`/accounts/${a}/withdrawals`, { amount: '1', currency: 'JPY' })).status, 201);
    assert.equal((await own.post(`/accounts/${b}/deposits`, { amount: '1', currency: 'JPY' })).status, 201);
    assert.equal((await own.get(`/accounts/${b}`)).body.balance, '2');
    // Transfers move money but don't create it, so they are never limited.
    assert.equal((await own.post('/transfers', { from_account_id: a, to_account_id: b, amount: '5', currency: 'JPY' })).status, 201);
  });
});

describe('all or nothing', () => {
  test('BK-R13 a failure between the debit and the credit leaves no transfer and no entries', async () => {
    const own = await startApi();
    const a = await own.openAccount('CAD');
    const b = await own.openAccount('CAD');
    await own.post(`/accounts/${a}/deposits`, { amount: '10.00', currency: 'CAD' });
    // Make the credit fail after the debit has been written.
    own.ledger.db.exec("CREATE TEMP TRIGGER fail_credit BEFORE INSERT ON ledger_entries WHEN NEW.amount > 0 BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const reply = await own.post('/transfers', { from_account_id: a, to_account_id: b, amount: '4.00', currency: 'CAD' });
    own.ledger.db.exec('DROP TRIGGER fail_credit');
    refused(reply, 500, 'internal');
    assert.equal(reply.body.error, 'internal error', 'the database error is not shown to the client');
    assert.deepEqual([(await own.get(`/accounts/${a}`)).body.balance, (await own.get(`/accounts/${b}`)).body.balance], ['10.00', '0.00']);
    const count = (sql: string) => Number((own.ledger.db.prepare(sql).get() as { n: number }).n);
    assert.equal(count('SELECT COUNT(*) AS n FROM transfers'), 1);
    assert.equal(count('SELECT COUNT(*) AS n FROM ledger_entries'), 2);
    // and the ledger still works afterwards
    assert.equal((await own.post('/transfers', { from_account_id: a, to_account_id: b, amount: '4.00', currency: 'CAD' })).status, 201);
  });
});

describe('the HTTP layer', () => {
  test('BK-R16 malformed JSON is 400 invalid_json', async () => {
    refused(await api.post('/accounts', '{"owner": "Ada",'), 400, 'invalid_json');
  });

  for (const body of ['[]', '"Ada"', '42', 'null']) {
    test(`BK-R16 a JSON body of ${body} is 400 invalid_body`, async () => {
      refused(await api.post('/accounts', body), 400, 'invalid_body');
    });
  }

  test('BK-R16 a POST that is not JSON is 415, even when the text is JSON', async () => {
    refused(await api.request('POST', '/accounts', '{"owner":"Ada","currency":"CAD"}', { 'Content-Type': 'text/plain' }), 415, 'unsupported_media_type');
    assert.equal((await api.request('POST', '/accounts', '{"owner":"Ada","currency":"CAD"}', { 'Content-Type': 'application/json; charset=utf-8' })).status, 201);
  });

  test('BK-R16 a body over 16 KB is 413; exactly 16 KB is read', async () => {
    const base = JSON.stringify({ owner: 'Ada', currency: 'CAD', pad: '' }).length;
    const pad = (size: number) => 'x'.repeat(size - base);
    const exact = JSON.stringify({ owner: 'Ada', currency: 'CAD', pad: pad(16 * 1024) });
    assert.equal(Buffer.byteLength(exact), 16 * 1024);
    assert.equal((await api.post('/accounts', exact)).status, 201);
    refused(await api.post('/accounts', JSON.stringify({ owner: 'Ada', currency: 'CAD', pad: pad(16 * 1024 + 1) })), 413, 'body_too_large');
  });

  test('BK-R16 a wrong method is 405 with the allowed ones in Allow', async () => {
    const id = await api.openAccount('CAD');
    const reply = await api.request('DELETE', `/accounts/${id}`);
    refused(reply, 405, 'method_not_allowed');
    assert.equal(reply.headers.get('allow'), 'GET');
    assert.equal((await api.request('GET', '/transfers')).headers.get('allow'), 'POST');
  });

  for (const path of ['/accounts/0', '/accounts/abc', '/accounts/01', '/accounts/1.0', '/accounts/-1', '/accounts/1/', '/nowhere', '/accounts/1234567890123456']) {
    test(`BK-R17 BK-R16 ${path} is 404`, async () => {
      refused(await api.get(path), 404, 'not_found');
    });
  }

  test('BK-R18 refusals carry the same headers as answers', async () => {
    const reply = await api.get('/nowhere');
    assert.match(reply.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(reply.headers.get('cache-control'), 'no-store');
    assert.equal(reply.headers.get('x-content-type-options'), 'nosniff');
  });

  test('BK-R16 /health answers 200', async () => {
    assert.deepEqual((await api.get('/health')).body, { status: 'ok' });
  });
});
