import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { startApi } from './helpers.ts';

// The UI as files and as served: headers, its policy, and code rules a browser test
// can't see. What the UI does is tested by Cypress (cypress/e2e); here, what it is.

const api = await startApi();
const file = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const html = file('index.html');
const js = file('app.js');

describe('the UI files as served', () => {
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/app.css', 'text/css']] as const) {
    test(`BK-R32 GET ${path} is ${type}, with the page policy, nosniff and no-store`, async () => {
      const res = await fetch(api.base + path);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', new RegExp(`^${type}`));
      assert.equal(res.headers.get('content-security-policy'), "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.ok((await res.text()).length > 100);
    });
  }

  test('BK-R32 BK-R16 a POST to a UI file is 405 with Allow: GET, as JSON', async () => {
    const reply = await api.request('POST', '/', {});
    assert.equal(reply.status, 405);
    assert.equal(reply.headers.get('allow'), 'GET');
    assert.equal(reply.body.code, 'method_not_allowed');
  });

  for (const path of ['/index.html', '/app.ts', '/../package.json', '/public/app.js', '/app.js/']) {
    test(`BK-R32 BK-R17 ${path} is not a UI file: 404 JSON`, async () => {
      const reply = await api.get(path);
      assert.equal(reply.status, 404);
      assert.equal(reply.body.code, 'not_found');
    });
  }
});

describe('the UI code', () => {
  test('BK-R32 the page has no inline script, style or event handler, so the policy needs no exception', () => {
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'a script without src');
    assert.doesNotMatch(html, /<style|\sstyle=/i);
    assert.doesNotMatch(html, /\son[a-z]+=/i);
    assert.doesNotMatch(html, /https?:\/\//i, 'anything from another origin');
  });

  test('BK-R32 the script builds pages with text, never HTML strings', () => {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
      assert.ok(!js.includes(sink), `app.js uses ${sink}`);
    }
  });

  test('BK-R33 the script never turns money into a number: no float parsing, rounding, formatting or number fields', () => {
    for (const banned of ['parseFloat', 'parseInt', 'toFixed', 'toPrecision', 'Math.', 'NumberFormat', 'toLocaleString', 'valueAsNumber', "type: 'number'", 'BigInt']) {
      assert.ok(!js.includes(banned), `app.js uses ${banned}`);
    }
    // Number() only for ids and Retry-After seconds, never on an amount or balance.
    const uses = js.split('\n').filter((line) => line.includes('Number('));
    assert.equal(uses.length, 2, uses.join('\n'));
    assert.ok(uses.every((line) => !/amount|balance/i.test(line)), uses.join('\n'));
    // No sums on amounts: one amount or balance added to, or taken from, another.
    assert.doesNotMatch(js, /(amount|balance)[\w.]*\s*[+\-*/]=?\s*[\w.]*(amount|balance)/i);
  });

  test('BK-R33 every amount field is a text field with a hint, not a number field', () => {
    assert.match(js, /name: 'amount', type: 'text'/);
    assert.match(js, /'aria-describedby': `\$\{ids\.hint\} \$\{ids\.error\}`/);
  });
});

describe('listing accounts', () => {
  test('BK-R31 BK-R07 GET /accounts lists customer accounts oldest first, with balances in each currency\'s decimals', async () => {
    const first = await api.openAccount('KWD', 'First');
    const second = await api.openAccount('JPY', 'Second');
    await api.post(`/accounts/${first}/deposits`, { amount: '1.5', currency: 'KWD' });
    const reply = await api.get('/accounts');
    assert.equal(reply.status, 200);
    const mine = reply.body.accounts.filter((a: { id: number }) => a.id === first || a.id === second);
    assert.deepEqual(mine.map((a: Record<string, unknown>) => [a.id, a.owner, a.currency, a.balance]), [
      [first, 'First', 'KWD', '1.500'],
      [second, 'Second', 'JPY', '0'],
    ]);
    const ids = reply.body.accounts.map((a: { id: number }) => a.id);
    assert.deepEqual(ids, [...ids].sort((a: number, b: number) => a - b));
  });

  test('BK-R31 BK-R14 the funding accounts are never listed, and every balance is the sum of its entries', async () => {
    const id = await api.openAccount('USD');
    await api.post(`/accounts/${id}/deposits`, { amount: '9.99', currency: 'USD' });
    await api.post(`/accounts/${id}/withdrawals`, { amount: '0.99', currency: 'USD' });
    const { accounts } = (await api.get('/accounts')).body;
    assert.ok(accounts.every((a: { owner: string }) => a.owner !== 'Funding'));
    for (const a of accounts) {
      const statement = (await api.get(`/accounts/${a.id}/entries`)).body;
      assert.equal(a.balance, statement.balance, `account ${a.id}`);
    }
    assert.equal(accounts.find((a: { id: number }) => a.id === id).balance, '9.00');
  });

  test('BK-R31 BK-R18 the list is JSON with no-store, and only GET and POST are allowed', async () => {
    const reply = await api.get('/accounts');
    assert.match(reply.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(reply.headers.get('cache-control'), 'no-store');
    const wrong = await api.request('DELETE', '/accounts');
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'GET, POST');
  });
});

describe('an empty bank', () => {
  test('BK-R31 GET /accounts on a new ledger is an empty list, not a 404', async () => {
    const fresh = await startApi();
    assert.deepEqual((await fresh.get('/accounts')).body, { accounts: [] });
  });
});
