import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, collectFiles, lintFiles } from '../src/cli.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../examples/', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const byTitle = (results, title) => results.find((r) => r.title === title);

test('parseArgs validates input', () => {
  assert.throws(() => parseArgs([]), /at least one/);
  assert.throws(() => parseArgs(['x', '--format', 'html']), /Unknown format/);
  assert.throws(() => parseArgs(['x', '--min-score', '120']), /0 to 100/);
  assert.deepEqual(parseArgs(['a.md', '--min-score', '80']), { paths: ['a.md'], format: 'text', minScore: 80 });
});

test('the examples score as documented', () => {
  const results = lintFiles(collectFiles([EXAMPLES]));
  assert.equal(results.length, 5);

  const goodMd = byTitle(results, "Discount code SAVE10 isn't applied to the checkout total");
  assert.equal(goodMd.score, 100);
  assert.equal(goodMd.status, 'Ready');

  const weak = byTitle(results, 'Checkout broken');
  assert.deepEqual(weak.findings.map((f) => f.rule).sort(), [
    'actual-vague', 'environment-missing', 'expected-missing', 'severity-invalid', 'steps-too-few', 'title-vague',
  ]);
  assert.equal(weak.score, 10);

  assert.equal(byTitle(results, 'Sort by price (low to high) lists the Onesie second instead of first').score, 100);

  const typo = byTitle(results, 'Typo on the checkout complete page');
  assert.deepEqual(typo.findings.map((f) => f.rule).sort(), ['evidence-missing', 'severity-mismatch']);
  assert.equal(typo.status, 'Needs polish');

  const same = byTitle(results, 'Cart badge');
  assert.ok(same.findings.some((f) => f.rule === 'expected-equals-actual'));
  assert.equal(same.status, 'Not ready');
});

test('CLI exits 1 when any report has errors', () => {
  const res = run(EXAMPLES);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /5 report\(s\): 2 ready, 1 need polish, 2 not ready/);
});

test('CLI exits 0 for a ready report and honours --min-score', () => {
  const good = fileURLToPath(new URL('../examples/good-report.md', import.meta.url));
  assert.equal(run(good).status, 0);
  assert.equal(run(good, '--min-score', '100').status, 0);
});

test('CLI prints a Markdown table', () => {
  const res = run(EXAMPLES, '--format', 'md');
  assert.match(res.stdout, /^\| Score \| Status \| Report \| Problems \|/);
  assert.match(res.stdout, /\| 10 \| Not ready \| weak-report\.md: Checkout broken \|/);
});

test('CLI exits 2 with a message for a missing path', () => {
  const res = run('no-such-folder');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such file|ENOENT/i);
});
