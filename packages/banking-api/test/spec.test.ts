import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// Keeps SPEC.md and the tests in step: every rule has a test, and no test names a
// rule that doesn't exist.

const here = new URL('./', import.meta.url);
const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
const rules = new Set([...spec.matchAll(/^\| (BK-R\d\d) \|/gm)].map((m) => m[1]!));
const tests = readdirSync(here).filter((f) => f.endsWith('.test.ts') && f !== 'spec.test.ts')
  .map((f) => readFileSync(new URL(f, here), 'utf8')).join('\n');
const cited = new Set([...tests.matchAll(/BK-R\d\d/g)].map((m) => m[0]));

test('SPEC.md has its 18 rules, numbered without gaps', () => {
  assert.deepEqual([...rules], Array.from({ length: 18 }, (_, i) => `BK-R${String(i + 1).padStart(2, '0')}`));
});

test('every rule in SPEC.md is checked by a test', () => {
  assert.deepEqual([...rules].filter((r) => !cited.has(r)), []);
});

test('every rule a test names is in SPEC.md', () => {
  assert.deepEqual([...cited].filter((r) => !rules.has(r)), []);
});
