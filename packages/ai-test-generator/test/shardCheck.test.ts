import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listedTests, ranTests, checkShards, toMarkdown } from '../src/shardCheck.ts';
import type { ShardReport, ShardTest } from '../src/shardCheck.ts';

// A report shaped like Playwright's JSON: file suite > describe suite > specs.
const report = (specs: Record<string, ShardTest[]>, file = 'login.spec.js'): ShardReport => ({
  suites: [{
    title: file,
    file,
    specs: [],
    suites: [{ title: 'Login', file, specs: Object.entries(specs).map(([title, tests]) => ({ title, file, tests })) }],
  }],
});
const listed = (...titles: string[]) => report(Object.fromEntries(titles.map((t) => [t, [{ results: [] }]])));
const passed = (retries = 0): ShardTest => ({ status: retries ? 'flaky' : 'expected', results: Array.from({ length: retries + 1 }, (_, retry) => ({ retry })) });

test('listedTests keys each test by file, describe titles and title', () => {
  assert.deepEqual(listedTests(listed('a', 'b')), ['login.spec.js › Login › a', 'login.spec.js › Login › b']);
});

test('listedTests adds the project name and normalizes Windows paths', () => {
  const r = report({ a: [{ projectName: 'chromium' }, { projectName: 'firefox' }] }, 'auth\\login.spec.js');
  assert.deepEqual(listedTests(r), ['auth/login.spec.js › Login › a [chromium]', 'auth/login.spec.js › Login › a [firefox]']);
});

test('a complete run passes', () => {
  const check = checkShards(listedTests(listed('a', 'b')), ranTests(report({ a: [passed()], b: [passed()] })));
  assert.equal(check.ok, true);
  assert.equal(check.ran, 2);
});

test('a retry is not a duplicate, but the test is reported as flaky', () => {
  const check = checkShards(listedTests(listed('a')), ranTests(report({ a: [passed(1)] })));
  assert.equal(check.ok, true);
  assert.equal(check.ran, 1);
  assert.deepEqual(check.flaky, ['login.spec.js › Login › a']);
});

test('a missing shard is caught even though every test that ran passed', () => {
  const check = checkShards(listedTests(listed('a', 'b', 'c')), ranTests(report({ a: [passed()] })));
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, ['login.spec.js › Login › b', 'login.spec.js › Login › c']);
});

test('a test merged from two shards is a duplicate, whatever its IDs', () => {
  // merge-reports gives the second copy a new ID; it shows up as a second spec.
  const merged: ShardReport = { suites: [...(report({ a: [passed()] }).suites ?? []), ...(report({ a: [passed()] }).suites ?? [])] };
  const check = checkShards(listedTests(listed('a')), ranTests(merged));
  assert.equal(check.ok, false);
  assert.equal(check.ran, 2);
  assert.deepEqual(check.duplicated, ['login.spec.js › Login › a']);
});

test('a test that ran but was never listed is caught', () => {
  const check = checkShards(listedTests(listed('a')), ranTests(report({ a: [passed()], extra: [passed()] })));
  assert.equal(check.ok, false);
  assert.deepEqual(check.unexpected, ['login.spec.js › Login › extra']);
});

test('a listed test that only appears without results counts as missing', () => {
  const check = checkShards(listedTests(listed('a')), ranTests(report({ a: [{ status: 'skipped', results: [] }] })));
  assert.deepEqual(check.missing, ['login.spec.js › Login › a']);
});

test('failures are reported but do not make the coverage check fail', () => {
  const check = checkShards(listedTests(listed('a')), ranTests(report({ a: [{ status: 'unexpected', results: [{ retry: 0 }, { retry: 1 }] }] })));
  assert.equal(check.ok, true);
  assert.deepEqual(check.failed, ['login.spec.js › Login › a']);
});

test('toMarkdown shows the counts and lists each problem', () => {
  const check = checkShards(listedTests(listed('a', 'b')), ranTests(report({ a: [passed()] })));
  const md = toMarkdown(check, 3);
  assert.match(md, /Shard check: INCOMPLETE/);
  assert.match(md, /\| 2 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(md, /Ran \(3 shard reports\)/);
  assert.match(md, /- login\.spec\.js › Login › b/);
  assert.doesNotMatch(md, /Ran more than once\*\*/);
});
