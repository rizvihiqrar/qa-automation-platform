// Cypress lists an intercepted call in `@alias.all` as soon as it is sent and adds its reply later.
// Reading `.response` in a `.then()` straight after `.all` can see undefined (banking-api-ui, CI run
// 41061173499, 2026-10-30: "second.response is undefined", fixed in b82fb64). A reply has to be read
// inside `.should()`, which retries. This test reads every Cypress spec and fails on the old pattern.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = path.join(ROOT, 'packages');

// The end of the call chain that starts at `start`: follows balanced (...) groups and continues
// while the next character is a `.`, so nested `cy.` commands inside a callback stay in the chain.
function chainEnd(source, start) {
  let i = source.indexOf('(', start);
  for (;;) {
    let depth = 0;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) break;
    }
    i++;
    const next = source.slice(i).match(/^\s*\.\w+\s*\(/);
    if (!next) return i;
    i = source.indexOf('(', i);
  }
}

// Call chains that start at cy.get('@name.all') (quotes or a template literal).
export function allStatements(source) {
  return [...source.matchAll(/cy\.get\(\s*[`'"]@[^`'"]*\.all[`'"]/g)].map((m) => ({
    line: source.slice(0, m.index).split('\n').length,
    text: source.slice(m.index, chainEnd(source, m.index)),
  }));
}

// True when a `.response` is read anywhere but inside a `.should(function)` callback: the nearest
// call before it in the chain must be `.should` with a function, not `.then`.
export function readsReplyOutsideShould(text) {
  for (const hit of text.matchAll(/\.response\b/g)) {
    const before = text.slice(0, hit.index);
    const should = Math.max(...[...before.matchAll(/\.should\(\s*(?:async\s*)?(?:\(|function|\w+\s*=>)/g)].map((m) => m.index), -1);
    const then = Math.max(...[...before.matchAll(/\.then\(/g)].map((m) => m.index), -1);
    if (should === -1 || then > should) return true;
  }
  return false;
}

const specs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : specs(full);
  return /\.cy\.(ts|tsx|js|jsx)$/.test(e.name) ? [full] : [];
});
const files = specs(PACKAGES);

test('there are Cypress specs, and the check finds @alias.all statements in them', () => {
  assert.ok(files.length >= 1, 'no *.cy.ts found, so the check would pass without looking');
  const found = files.flatMap((f) => allStatements(fs.readFileSync(f, 'utf8')));
  assert.ok(found.length >= 3, `found ${found.length} @alias.all statements: the pattern may have stopped matching`);
});

test('no Cypress spec reads a reply from @alias.all outside a retrying should()', () => {
  const bad = files.flatMap((file) => allStatements(fs.readFileSync(file, 'utf8'))
    .filter((s) => readsReplyOutsideShould(s.text))
    .map((s) => `${path.relative(ROOT, file)}:${s.line}`));
  assert.deepEqual(bad, [], 'read .response inside cy.get(\'@x.all\').should((all) => { ... }) so Cypress retries until the reply is there');
});

const check = (source) => allStatements(source).map((s) => readsReplyOutsideShould(s.text));

test('the check finds the 2026-10-30 mistake and accepts the fix', () => {
  const old = "cy.get('@deposit.all').then((all) => {\n  expect(all[1].response.headers['x']).to.equal('true');\n});\ncy.get('x')";
  const fixed = "cy.get('@deposit.all').should((all) => {\n  expect(all[1].response?.headers['x']).to.equal('true');\n});\ncy.get('x')";
  assert.deepEqual(check(old), [true]);
  assert.deepEqual(check(fixed), [false]);
});

test('a reply read in .then() after a should() is still caught, and so is a later read', () => {
  assert.deepEqual(check("cy.get('@x.all').should('have.length', 2).then((c) => {\n  c[1].response.status;\n});"), [true]);
  assert.deepEqual(check("cy.get('@x.all').should((a) => { a[0].response?.status; }).then((a) => a[1].response.status);"), [true]);
});

test('a nested cy command, a template literal alias and a longer property name do not hide or fake a read', () => {
  assert.deepEqual(check("cy.get('@x.all').then((a) => {\n  cy.wrap(1);\n  a[1].response.status;\n});"), [true]);
  assert.deepEqual(check('cy.get(`@${name}.all`).then((a) => a[0].response.status);'), [true]);
  assert.deepEqual(check("cy.get('@x.all').then((a) => a[0].responseTime);"), [false]);
});

test('reading only the request, which is there at once, is allowed', () => {
  assert.deepEqual(check("cy.get('@w.all').should('have.length', 2).then((calls) => {\n  calls.map((c) => c.request.headers['k']);\n});\ncy.get('x')"), [false]);
});
