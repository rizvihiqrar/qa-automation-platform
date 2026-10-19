// Cited tests: an answer must name a test that is in its own case's spec.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badCitations, cite, testTitles } from '../src/attribution.ts';
import { loadRuns } from '../src/record.ts';
import { loadItems } from '../src/render.ts';

const spec = [
  "test('adds a product @smoke', async () => {});",
  'test.skip("removes it", async () => {});',
  "test('user\\'s cart persists @regression', async () => {});",
  "test.describe('not a test title', () => {});",
].join('\n');

test('testTitles reads test, test.skip and escaped quotes, not describe blocks', () => {
  assert.deepEqual(testTitles(spec), ['adds a product @smoke', 'removes it', "user's cart persists @regression"]);
});

test('cite: exact, tags dropped or shortened (loose), absent, or none', () => {
  assert.equal(cite(spec, 'adds a product @smoke'), 'exact');
  assert.equal(cite(spec, 'adds a product'), 'loose');
  assert.equal(cite(spec, "cart persists"), 'loose');
  assert.equal(cite(spec, 'removes'), 'absent', 'too short to count as a shortened title');
  assert.equal(cite(spec, 'not a test title'), 'absent');
  assert.equal(cite(spec, null), 'none');
});

test('badCitations tells a test from another spec apart from an invented one', () => {
  const items = [
    { id: 'A', feature: 'f', spec: 'a', criterion: 'c' },
    { id: 'B', feature: 'f', spec: 'b', criterion: 'c' },
  ];
  const specs: Record<string, string> = { a: "test('opens the cart', () => {})", b: "test('logs out', () => {})" };
  const runs = [{ name: 'r', answers: [
    { id: 'A', test: 'logs out' },
    { id: 'B', test: 'logs out' },
    { id: 'B', test: 'checks the total is $32.39' },
  ] }];
  assert.deepEqual(badCitations(runs, items, (i) => specs[i.spec] ?? ''), [
    { run: 'r', id: 'A', test: 'logs out', kind: 'elsewhere', foundIn: ['B'] },
    { run: 'r', id: 'B', test: 'checks the total is $32.39', kind: 'invented', foundIn: [] },
  ]);
});

test('Day 40: exactly 8 answers in two runs were filed under the wrong case, none invented', () => {
  const bad = badCitations(loadRuns(), loadItems());
  assert.deepEqual(
    bad.map((b) => `${b.run} ${b.id} ${b.kind}`),
    [
      'haiku-v2-3 J41 elsewhere', 'haiku-v2-3 J42 elsewhere', 'haiku-v2-3 J43 elsewhere', 'haiku-v2-3 J44 elsewhere', 'haiku-v2-3 J45 elsewhere',
      'sonnet-2 J28 elsewhere', 'sonnet-2 J29 elsewhere', 'sonnet-2 J30 elsewhere',
    ],
  );
});
