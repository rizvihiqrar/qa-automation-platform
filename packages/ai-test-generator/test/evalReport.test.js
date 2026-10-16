import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRunResults, summarize, toMarkdown, fixesTemplate } from '../src/evalReport.js';
import { parseEvalArgs } from '../src/eval.js';

const review = (passed, findings = []) => ({ tests: 3, passed, findings });
const counts = (passed, failed = 0) => ({ total: passed + failed, passed, failed, flaky: 0, skipped: 0 });

test('collectRunResults counts statuses per spec file, including nested suites', () => {
  const report = {
    suites: [
      {
        file: 'feature-login.spec.js',
        specs: [],
        suites: [{
          file: 'feature-login.spec.js',
          specs: [
            { title: 'a', file: 'feature-login.spec.js', tests: [{ status: 'expected' }] },
            { title: 'b', file: 'feature-login.spec.js', tests: [{ status: 'unexpected' }] },
          ],
          suites: [],
        }],
      },
      { file: 'feature-cart.spec.js', specs: [{ title: 'c', file: 'feature-cart.spec.js', tests: [{ status: 'flaky' }, { status: 'skipped' }] }], suites: [] },
    ],
  };
  const results = collectRunResults(report);
  assert.deepEqual(results.get('feature-login.spec.js'), { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0 });
  assert.deepEqual(results.get('feature-cart.spec.js'), { total: 2, passed: 0, failed: 0, flaky: 1, skipped: 1 });
});

test('summarize computes review, pass and usable-as-is rates', () => {
  const { rows, totals } = summarize([
    { feature: 'login', review: review(true), run: counts(4) },
    { feature: 'cart', review: review(true, [{ severity: 'warning', rule: 'fixed-wait' }]), run: counts(3) },
    { feature: 'sort', review: review(false, [{ severity: 'error', rule: 'no-assertion' }]), run: counts(2, 2) },
    { feature: 'logout', review: review(true), run: null },
  ]);
  assert.equal(totals.features, 4);
  assert.equal(totals.reviewPassed, 3);
  assert.equal(totals.testsRun, 11);
  assert.equal(totals.testsPassed, 9);
  assert.equal(totals.testPassRate, 82);
  assert.equal(totals.clean, 1); // only login: clean review and every test passed
  assert.equal(totals.ran, 3);
  assert.deepEqual(rows.find((r) => r.feature === 'cart').rules, ['fixed-wait']);
  assert.equal(rows.find((r) => r.feature === 'logout').ran, false);
});

test('a spec whose tests all pass but has review warnings is not usable as-is', () => {
  const { rows } = summarize([{ feature: 'x', review: review(true, [{ severity: 'warning', rule: 'brittle-selector' }]), run: counts(3) }]);
  assert.equal(rows[0].clean, false);
});

test('rates are zero rather than NaN when nothing ran', () => {
  const { totals } = summarize([{ feature: 'x', review: review(false, [{ severity: 'error', rule: 'no-tests' }]), run: null }]);
  assert.equal(totals.testPassRate, 0);
  assert.equal(totals.cleanRate, 0);
});

test('toMarkdown includes the summary and one row per feature', () => {
  const md = toMarkdown(summarize([
    { feature: 'login', review: review(true), run: counts(4) },
    { feature: 'logout', review: review(true), run: null },
  ]), { label: 'L1', model: 'claude-opus-5-5' });
  assert.match(md, /^# Eval run: L1/);
  assert.match(md, /\| Generated tests that passed on the first run \| 4 of 4 \(100%\) \|/);
  assert.match(md, /\| logout \| pass \| 0 \| 0 \| — \| did not run \|/);
});

test('fixesTemplate lists only specs that need work, with the reason', () => {
  const md = fixesTemplate(summarize([
    { feature: 'login', review: review(true), run: counts(4) },
    { feature: 'sort', review: review(true), run: counts(1, 2) },
  ]), { label: 'L1' });
  assert.ok(!md.includes('## login'));
  assert.match(md, /## sort\n\nFlagged: 2 of 3 tests failed/);
});

test('fixesTemplate says so when every spec was usable', () => {
  const md = fixesTemplate(summarize([{ feature: 'login', review: review(true), run: counts(4) }]), { label: 'L1' });
  assert.match(md, /Every spec was usable as generated/);
});

test('parseEvalArgs needs exactly one mode and defaults the label to today', () => {
  assert.throws(() => parseEvalArgs([]), /exactly one/);
  assert.throws(() => parseEvalArgs(['--generate', '--score', 'x']), /exactly one/);
  const gen = parseEvalArgs(['--generate'], '2026-10-17');
  assert.equal(gen.label, '2026-10-17');
  assert.equal(gen.runDir.replace(/\\/g, '/'), 'eval/runs/2026-10-17');
  assert.equal(parseEvalArgs(['--score', 'eval/runs/old']).runDir, 'eval/runs/old');
});
