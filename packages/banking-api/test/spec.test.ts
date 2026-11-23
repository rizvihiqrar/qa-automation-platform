import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// Keeps SPEC.md and the tests in step: every rule has a test, and no test names a
// rule that doesn't exist. The Cypress specs (cypress/e2e) and the proxy tests (test-proxy) count as tests too.

const here = new URL('./', import.meta.url);
const e2e = new URL('../cypress/e2e/', import.meta.url);
const proxy = new URL('../test-proxy/', import.meta.url);
const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
const rules = new Set([...spec.matchAll(/^\| (BK-R\d\d) \|/gm)].map((m) => m[1]!));
const tests = readdirSync(here).filter((f) => f.endsWith('.test.ts') && f !== 'spec.test.ts')
  .map((f) => readFileSync(new URL(f, here), 'utf8'))
  .concat(readdirSync(e2e).filter((f) => f.endsWith('.cy.ts')).map((f) => readFileSync(new URL(f, e2e), 'utf8')))
  .concat(readdirSync(proxy).filter((f) => f.endsWith('.test.ts')).map((f) => readFileSync(new URL(f, proxy), 'utf8')))
  .join('\n');
const cited = new Set([...tests.matchAll(/BK-R\d\d/g)].map((m) => m[0]));

test('SPEC.md has its 49 rules, numbered without gaps', () => {
  assert.deepEqual([...rules], Array.from({ length: 49 }, (_, i) => `BK-R${String(i + 1).padStart(2, '0')}`));
});

test('every rule in SPEC.md is checked by a test', () => {
  assert.deepEqual([...rules].filter((r) => !cited.has(r)), []);
});

test('the README and the guide state the rule count and the number of deliberate mistakes that SPEC.md and the table hold', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const guide = readFileSync(new URL('../TECHNICAL.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const numbers = [...guide.matchAll(/^\| B(\d+) \|/gm)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, i) => i + 1), 'the deliberate-break rows are numbered without gaps');
  const breaks = numbers.length;
  for (const sentence of [
    `${rules.size} written [rules](SPEC.md)`,
    `${breaks} mistakes were put back on purpose`,
    `- ${rules.size} numbered [rules](SPEC.md)`,
    `- ${breaks} deliberate mistakes, each caught`,
    `| ${breaks} of ${breaks} |`,
  ]) assert.ok(readme.includes(sentence), `README.md does not say "${sentence}"`);
  assert.ok(guide.includes(`All ${breaks} were caught`), `TECHNICAL.md does not say "All ${breaks} were caught"`);
});

test('every rule a test names is in SPEC.md', () => {
  assert.deepEqual([...cited].filter((r) => !rules.has(r)), []);
});
