import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { gotoWithRetry, isNetworkError } from '../tests/review/gotoRetry.js';

const reset = () => new Error('page.goto: net::ERR_CONNECTION_RESET at https://www.saucedemo.com/');

// A fake page whose goto fails with the given errors first, then succeeds.
const fakePage = (errors: Error[]) => {
  const calls: string[] = [];
  return {
    calls,
    goto: async (url: string) => {
      calls.push(url);
      const err = errors.shift();
      if (err) throw err;
      return 'ok';
    },
  };
};

test('a connection reset is retried and the next try is used', async () => {
  const page = fakePage([reset()]);
  assert.equal(await gotoWithRetry(page, 'https://x', { waitMs: 0 }), 'ok');
  assert.equal(page.calls.length, 2);
});

test('it gives up after the set number of attempts and throws the network error', async () => {
  const page = fakePage([reset(), reset(), reset(), reset()]);
  await assert.rejects(gotoWithRetry(page, 'https://x', { attempts: 3, waitMs: 0 }), /ERR_CONNECTION_RESET/);
  assert.equal(page.calls.length, 3);
});

test('an error that is not a network error is thrown at once, never retried', async () => {
  const page = fakePage([new Error('page.goto: Timeout 30000ms exceeded')]);
  await assert.rejects(gotoWithRetry(page, 'https://x', { waitMs: 0 }), /Timeout/);
  assert.equal(page.calls.length, 1);
});

test('isNetworkError ignores empty and unrelated errors', () => {
  assert.equal(isNetworkError(undefined), false);
  assert.equal(isNetworkError(new Error('expect(locator).toHaveText failed')), false);
  assert.equal(isNetworkError(reset()), true);
});

// The check that keeps the fix in place: the shared login must navigate through the retry.
test('no review file navigates with a bare page.goto, so a new spec cannot bring the flake back', () => {
  const dir = new URL('../tests/review/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'gotoRetry.js');
  assert.ok(files.length >= 5, 'expected the review helpers and specs');
  const bare = files.filter((f) => /^[^/\n]*\bpage\.goto\(/m.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(bare, []);
});

test('Firefox network error names are retried too', () => {
  assert.equal(isNetworkError(new Error('page.goto: NS_ERROR_NET_RESET')), true);
  assert.equal(isNetworkError('net::ERR_CONNECTION_ABORTED'), true);
});
