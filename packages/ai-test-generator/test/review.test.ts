import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reviewSpec, findTests } from '../src/review.ts';

const rules = (src: string) => reviewSpec(src).findings.map((f) => f.rule);

const good = `
import { test, expect } from '@playwright/test';
test.describe('Login', () => {
  test('valid login @smoke', async ({ page }) => {
    await page.fill('[data-test="username"]', 'standard_user');
    await expect(page).toHaveURL(/inventory/);
  });
  test('bad password @regression', async ({ page }) => {
    await expect(page.locator('[data-test="error"]')).toBeVisible();
  });
});
`;

test('a clean spec passes with no findings', () => {
  const review = reviewSpec(good);
  assert.equal(review.tests, 2);
  assert.deepEqual(review.findings, []);
  assert.equal(review.passed, true);
});

test('findTests reports titles, lines and bodies', () => {
  const tests = findTests(good);
  assert.deepEqual(tests.map((t) => t.title), ['valid login @smoke', 'bad password @regression']);
  const [first] = tests;
  assert.ok(first);
  assert.equal(first.line, 4);
  assert.match(first.body, /toHaveURL/);
});

test('a test without expect() is an error', () => {
  const src = good.replace("await expect(page.locator('[data-test=\"error\"]')).toBeVisible();", "await page.click('[data-test=\"x\"]');");
  const review = reviewSpec(src);
  assert.ok(rules(src).includes('no-assertion'));
  assert.equal(review.passed, false);
});

test('fixed waits are flagged', () => {
  assert.ok(rules(good.replace('await expect(page).toHaveURL', 'await page.waitForTimeout(3000);\n    await expect(page).toHaveURL')).includes('fixed-wait'));
});

test('CSS class and XPath selectors are flagged as brittle', () => {
  assert.ok(rules(good.replace('[data-test="username"]', '.user-input')).includes('brittle-selector'));
  assert.ok(rules(good.replace('[data-test="username"]', '//input[@id="u"]')).includes('brittle-selector'));
});

test('leftover markdown fences and test.only are errors', () => {
  assert.equal(reviewSpec('```js\n' + good + '\n```').passed, false);
  assert.ok(rules(good.replace("test('valid login", "test.only('valid login")).includes('focused-test'));
});

test('smoke tagging: none or more than one is flagged', () => {
  assert.ok(rules(good.replace('@smoke', '@regression')).includes('smoke-tag'));
  assert.ok(rules(good.replace('@regression', '@smoke')).includes('smoke-tag'));
});

test('a file with no tests is an error', () => {
  assert.equal(reviewSpec("import { test } from '@playwright/test';").passed, false);
});

test('the reviewed example output passes the review', () => {
  const src = fs.readFileSync(new URL('../examples/output/login.spec.js', import.meta.url), 'utf8');
  const review = reviewSpec(src);
  assert.equal(review.tests, 4);
  assert.deepEqual(review.findings, []);
});
