import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import type { Store } from '../src/ledger.ts';

// The ledger is used through Store, whose methods are async. On SQLite the work inside
// each one is done before its promise is handed back, so a call that is not awaited still
// happens in time and no behaviour test can see it: putting back a missing await on
// releaseKey or on the audit row passed all 451 tests. Over a network store the same call
// would finish after the reply. So the source is read instead: every call to a Store
// method is awaited, returned or chained, here and in every package that runs this ledger.
//
// It is a text scan, not the type checker (TypeScript 7 has no JavaScript API yet), so it
// can't see that a `return` inside a callback whose result is thrown away returns nowhere.

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = join(PACKAGE, '..');
const ledgerSource = readFileSync(join(PACKAGE, 'src', 'ledger.ts'), 'utf8');

// The method names, from the interface itself, so a new method is covered at once.
// now() is the one plain function: the store's clock, read without a round trip.
export const storeMethods = (source = ledgerSource): string[] => {
  const body = /export interface Store \{([\s\S]*?)\r?\n\}/.exec(source)?.[1];
  assert.ok(body, 'ledger.ts has an exported Store interface');
  return [...body.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]!);
};

// The names a file holds a store in: anything called ledger, and anything made by
// `new Ledger(` or `buildSample(`.
const storeNames = (text: string): string[] =>
  [...new Set(['ledger', ...[...text.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:new Ledger|buildSample)\(/g)].map((m) => m[1]!)])];

// The Store calls in one file that are neither awaited, returned nor chained, as "line: text".
export function floatingCalls(text: string, methods: string[]): string[] {
  const async = methods.filter((m) => m !== 'now');
  const call = new RegExp(`\\b(?:\\w+\\.)*(?:${storeNames(text).join('|')})\\??\\.(?:${async.join('|')})\\(`, 'g');
  const found: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    for (const m of line.matchAll(call)) {
      const before = line.slice(0, m.index);
      const after = line.slice(m.index);
      const handled = /(?:\bawait|\breturn|=>)\s*\(?\s*$/.test(before)
        || /\bPromise\.(?:all|allSettled)\(/.test(before)
        || /^[^;]*?\)\.(?:then|catch|finally)\(/.test(after);
      if (!handled) found.push(`${i + 1}: ${line.trim()}`);
    }
  });
  return found;
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|mts|js|mjs)$/.test(entry.name) ? [path] : [];
  });

// This package's code and tests, and every file in another package that runs this ledger
// (visual-regression-demo starts it for its screenshots, money-course plants bugs in a copy).
// This file is left out: its own test below holds floating calls on purpose.
export function filesToScan(): string[] {
  const own = ['src', 'test', 'test-proxy'].flatMap((d) => sourceFiles(join(PACKAGE, d)));
  const others = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'banking-api')
    .flatMap((d) => ['src', 'test', 'tests'].flatMap((sub) => {
      try { return sourceFiles(join(PACKAGES, d.name, sub)); } catch { return []; }
    }))
    .filter((file) => { const text = readFileSync(file, 'utf8'); return text.includes('banking-api/') && /\bLedger\b/.test(text); });
  return [...own, ...others].filter((file) => file !== fileURLToPath(import.meta.url));
}

describe('every Store call is awaited', () => {
  test('the Store interface lists the methods the API uses', () => {
    const methods = storeMethods();
    for (const m of ['check', 'apply', 'claimKey', 'releaseKey', 'recordDecision', 'cashTotal', 'close', 'now']) assert.ok(methods.includes(m), m);
  });

  test('the scan reads this package and the other packages that run its ledger', () => {
    const files = filesToScan().map((f) => relative(PACKAGES, f).replaceAll('\\', '/'));
    for (const f of ['banking-api/src/app.ts', 'banking-api/src/aml.ts', 'banking-api/test-proxy/proxy.ts', 'banking-api/test/helpers.ts', 'visual-regression-demo/src/serve.ts', 'money-course/src/plant.ts']) {
      assert.ok(files.includes(f), f);
    }
  });

  test('every call to a Store method is awaited, returned or chained', () => {
    const methods = storeMethods();
    const floating = filesToScan().flatMap((f) => floatingCalls(readFileSync(f, 'utf8'), methods).map((c) => `${relative(PACKAGES, f)}:${c}`));
    assert.deepEqual(floating, []);
  });

  test('the scan finds a call left floating, and passes awaited, returned, chained and commented ones', () => {
    const methods = storeMethods();
    const text = [
      '    if (!written) ctx.ledger.releaseKey(key);',
      "    void ledger.recordDecision(m, 'allowed', null, 'no rule applied');",
      '  ledger?.close();',
      "  const first = new Ledger(file);",
      "  first.deposit(account.id, 500n, 'CAD');",
      '  const sample = await buildSample(path);',
      "  sample.releaseKey('in-flight');",
      "  api.ledger.openAccount('Ada', 'CAD');",
      '    if (!written) await ctx.ledger.releaseKey(key);',
      '  return [201, transfer(unwrap(await ledger.apply(m, key)))];',
      '  const total = (await ledger.cashTotal(a, k, s)) + m.amount;',
      '  return ledger.getAccount(id);',
      '  server.close(() => { ledger.close().then(resolve, resolve); });',
      '  const both = await Promise.all([ledger.getAccount(a), ledger.getAccount(b)]);',
      '  const opened = async () => ledger.openAccount(owner, currency);',
      '  // ledger.releaseKey(key) is not called here',
      '  const since = ledger.now();',
      '  server.close();',
    ].join('\n');
    assert.deepEqual(floatingCalls(text, methods), [
      '1: if (!written) ctx.ledger.releaseKey(key);',
      "2: void ledger.recordDecision(m, 'allowed', null, 'no rule applied');",
      '3: ledger?.close();',
      "5: first.deposit(account.id, 500n, 'CAD');",
      "7: sample.releaseKey('in-flight');",
      "8: api.ledger.openAccount('Ada', 'CAD');",
    ]);
  });
});

describe('a reply that cannot be sent', () => {
  test('BK-R18 a refusal with no valid status is a 500 in JSON, not a request left without an answer', async () => {
    // A store whose forecast is a refusal with status 0: what a check that was not awaited
    // looks like to the code after it. The reply for it can't be written as it is.
    const store = { check: async () => ({ ok: false, status: 0, code: 'odd', error: 'odd' }) } as unknown as Store;
    const server = createApp(store);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const original = console.error;
    console.error = () => {};
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/accounts/1/deposits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: '1.00', currency: 'CAD' }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(res.status, 500);
      assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
      assert.deepEqual(await res.json(), { error: 'internal error', code: 'internal' });
    } finally {
      console.error = original;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
