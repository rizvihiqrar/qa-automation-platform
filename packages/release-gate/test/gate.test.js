import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fromPlaywright, fromK6, fromCheck } from '../src/adapters.js';
import { decide, formatMarkdown } from '../src/gate.js';

const fixture = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const smoke = fixture('smoke-playwright.json'); // real qa-practice-api smoke run: 10 passed
const k6 = fixture('k6-load.json');              // real k6 load summary: all thresholds met
const policy = { requiredChecks: ['smoke-tests', 'api-contract', 'performance'], maxFailedTests: 0, maxFlakyTests: 1 };

const green = () => [
  fromPlaywright('smoke-tests', smoke),
  fromCheck('api-contract', { passed: true, summary: '20/20 responses match the spec' }),
  fromK6('performance', k6),
];
const withStats = (stats, errors = []) => ({ ...smoke, stats: { ...smoke.stats, ...stats }, errors });

test('adapters read real Playwright and k6 output', () => {
  assert.deepEqual(fromPlaywright('smoke-tests', smoke), {
    name: 'smoke-tests', kind: 'tests', passed: true,
    counts: { passed: 10, failed: 0, flaky: 0, skipped: 0, loadErrors: 0 },
    detail: '10/10 passed, 0 failed, 0 flaky',
  });
  assert.deepEqual(fromK6('performance', k6), { name: 'performance', kind: 'performance', passed: true, detail: '6/6 thresholds met' });
});

test('all checks green means GO', () => {
  const out = decide(policy, green());
  assert.equal(out.decision, 'go');
  assert.deepEqual(out.reasons, []);
  assert.deepEqual(out.checks.map((c) => c.status), ['pass', 'pass', 'pass']);
});

test('a failed test blocks the release', () => {
  const results = green();
  results[0] = fromPlaywright('smoke-tests', withStats({ expected: 9, unexpected: 1 }));
  const out = decide(policy, results);
  assert.equal(out.decision, 'no-go');
  assert.deepEqual(out.reasons, ['smoke-tests: 1 failed test(s), limit is 0']);
});

test('flaky tests are allowed up to the limit, then block', () => {
  const one = green(); one[0] = fromPlaywright('smoke-tests', withStats({ expected: 9, flaky: 1 }));
  assert.equal(decide(policy, one).decision, 'go');
  const two = green(); two[0] = fromPlaywright('smoke-tests', withStats({ expected: 8, flaky: 2 }));
  assert.deepEqual(decide(policy, two).reasons, ['smoke-tests: 2 flaky test(s), limit is 1']);
});

test('a policy that allows some failures does not block on them', () => {
  const results = green();
  results[0] = fromPlaywright('smoke-tests', withStats({ expected: 9, unexpected: 1 }));
  assert.equal(decide({ ...policy, maxFailedTests: 1 }, results).decision, 'go');
});

test('no tests run, or a test file that failed to load, blocks', () => {
  const none = green(); none[0] = fromPlaywright('smoke-tests', withStats({ expected: 0 }));
  assert.deepEqual(decide(policy, none).reasons, ['smoke-tests: no tests ran']);
  const broken = green(); broken[0] = fromPlaywright('smoke-tests', withStats({}, [{ message: 'SyntaxError' }]));
  assert.deepEqual(decide(policy, broken).reasons, ['smoke-tests: 1 test file(s) failed to load']);
});

test('a missed performance threshold blocks and names the threshold', () => {
  const slow = structuredClone(k6);
  slow.metrics['http_req_duration{name:list products}'].thresholds['p(95)<50'].ok = false;
  const results = green(); results[2] = fromK6('performance', slow);
  const out = decide(policy, results);
  assert.deepEqual(out.reasons, ['performance: failed: http_req_duration{name:list products}: p(95)<50']);
});

test('a failed contract check blocks', () => {
  const results = green(); results[1] = fromCheck('api-contract', { passed: false, summary: '18/20 responses match the spec' });
  assert.deepEqual(decide(policy, results).reasons, ['api-contract: 18/20 responses match the spec']);
});

test('a required check with no result blocks and is listed as missing', () => {
  const out = decide(policy, green().slice(0, 2));
  assert.deepEqual(out.reasons, ['Required check "performance" has no result']);
  assert.deepEqual(out.checks.at(-1), { name: 'performance', status: 'missing', detail: 'no result' });
});

test('fromCheck rejects a result without a boolean "passed"', () => {
  assert.throws(() => fromCheck('x', { ok: true }), /boolean "passed"/);
});

test('the report shows the decision, every check and the blocking reasons', () => {
  const results = green(); results[1] = fromCheck('api-contract', { passed: false, summary: '18/20 responses match the spec' });
  const md = formatMarkdown(decide(policy, results), { version: '1.4.0' });
  assert.match(md, /^## Release gate for 1\.4\.0: ⛔ NO-GO/);
  assert.match(md, /\| api-contract \| fail \| 18\/20 responses match the spec \|/);
  assert.match(md, /\*\*Blocking:\*\*\n- api-contract: 18\/20/);
  assert.match(formatMarkdown(decide(policy, green())), /✅ GO/);
});
