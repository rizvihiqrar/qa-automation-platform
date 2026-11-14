import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PACKAGES } from '../eslint.config.mjs';
import { CONFIG, ROOT, linter } from '../lint.mjs';

const UNAWAITED = `import { expect, test } from '@playwright/test';
test('t', async ({ page }) => {
  expect(page.locator('#x')).toHaveText('2');
});
`;

test('the deliberately unawaited fixture is reported', async () => {
  const [result] = await linter().lintFiles(['tools/playwright-lint/fixtures/unawaited.spec.ts']);
  const lines = result.messages.map((m) => `${m.line} ${m.ruleId}`);
  // toBeVisible and toHaveTitle; fill() is not an assertion, so the rule leaves it
  // (an unawaited action is caught by a test timing out, not by this rule).
  assert.deepEqual(lines, ['6 playwright/missing-playwright-await', '8 playwright/missing-playwright-await']);
});

test('the rule is on in every Playwright package', async () => {
  const eslint = linter();
  for (const pkg of PACKAGES) {
    for (const file of ['tests/new.spec.ts', 'e2e/new.spec.js', 'evidence/new.spec.ts']) {
      const filePath = path.join(ROOT, 'packages', pkg, file);
      const [result] = await eslint.lintText(UNAWAITED, { filePath });
      assert.equal(result.errorCount, 1, `${pkg}/${file}`);
    }
  }
});

test('a bare locator.count() in a fixture is reported', async () => {
  const [result] = await linter().lintFiles(['tools/playwright-lint/fixtures/count.spec.ts']);
  assert.deepEqual(result.messages.map((m) => `${m.line} ${m.ruleId}`), ['6 no-restricted-syntax']);
});

const COUNT = `import { test } from '@playwright/test';
test('t', async ({ page }) => {
  const n = await page.locator('#x').count();
});
`;

test('count() is reported in a spec of every Playwright package', async () => {
  const eslint = linter();
  for (const pkg of PACKAGES) {
    const filePath = path.join(ROOT, 'packages', pkg, 'tests', 'new.spec.ts');
    const [result] = await eslint.lintText(COUNT, { filePath });
    assert.deepEqual(result.messages.map((m) => m.ruleId), ['no-restricted-syntax'], pkg);
  }
});

test('count() is allowed outside specs, where a page object may wait first', async () => {
  const filePath = path.join(ROOT, 'packages', 'bdd-playwright-demo', 'pageObjects', 'New.ts');
  const [result] = await linter().lintText(COUNT, { filePath });
  assert.equal(result.errorCount, 0);
});

test('an awaited expect passes', async () => {
  const filePath = path.join(ROOT, 'packages', PACKAGES[0], 'tests', 'ok.spec.ts');
  const [result] = await linter().lintText(UNAWAITED.replace('  expect(', '  await expect('), { filePath });
  assert.equal(result.errorCount, 0);
});

test('every package that depends on Playwright is linted', () => {
  const missing = fs.readdirSync(path.join(ROOT, 'packages')).filter((pkg) => {
    const file = path.join(ROOT, 'packages', pkg, 'package.json');
    if (!fs.existsSync(file)) return false;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const deps = { ...json.dependencies, ...json.devDependencies };
    return ('@playwright/test' in deps || 'playwright' in deps) && !PACKAGES.includes(pkg);
  });
  assert.deepEqual(missing, [], 'add these to PACKAGES in eslint.config.mjs');
});

test('the config file exists where lint.mjs looks for it', () => {
  assert.ok(fs.existsSync(CONFIG));
});

// A195: a state read kept in a variable goes stale. The stored-state fixture has three,
// and the Locator version below them, which must not be reported.
test('state reads kept in a variable are reported, and the Locator version is not', async () => {
  const [result] = await linter().lintFiles(['tools/playwright-lint/fixtures/stored-state.spec.ts']);
  assert.deepEqual(result.messages.map((m) => `${m.line} ${m.ruleId}`), ['8 no-restricted-syntax', '9 no-restricted-syntax', '10 no-restricted-syntax']);
  assert.match(result.messages[0].message, /goes stale/);
});

const STORED = `import { test } from '@playwright/test';
test('t', async ({ page }) => {
  const visible = await page.locator('#x').isVisible();
});
`;

test('a stored state read is reported in a spec of every Playwright package', async () => {
  const eslint = linter();
  for (const pkg of PACKAGES) {
    const filePath = path.join(ROOT, 'packages', pkg, 'tests', 'new.spec.ts');
    const [result] = await eslint.lintText(STORED, { filePath });
    assert.deepEqual(result.messages.map((m) => m.ruleId), ['no-restricted-syntax'], pkg);
  }
});

test('every state method the rule names is reported, and a read that is not stored is not', async () => {
  const filePath = path.join(ROOT, 'packages', PACKAGES[0], 'tests', 'new.spec.ts');
  const methods = ['isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked', 'isEditable', 'textContent', 'innerText', 'innerHTML', 'inputValue', 'getAttribute', 'allTextContents', 'allInnerTexts'];
  for (const m of methods) {
    const [result] = await linter().lintText(STORED.replace('isVisible', m), { filePath });
    assert.equal(result.errorCount, 1, m);
  }
  const notStored = `import { test } from '@playwright/test';
test('t', async ({ page }) => {
  const body = await page.content();
  const reply = await (await page.request.get('/x')).text();
});
`;
  const [ok] = await linter().lintText(notStored, { filePath });
  assert.equal(ok.errorCount, 0);
});

test('a stored read is allowed outside specs and with a reason comment', async () => {
  const outside = path.join(ROOT, 'packages', 'bdd-playwright-demo', 'pageObjects', 'New.ts');
  assert.equal((await linter().lintText(STORED, { filePath: outside }))[0].errorCount, 0);
  const spec = path.join(ROOT, 'packages', PACKAGES[0], 'tests', 'new.spec.ts');
  const withReason = STORED.replace('  const visible', '  // eslint-disable-next-line no-restricted-syntax -- kept to compare with the next page\n  const visible');
  assert.equal((await linter().lintText(withReason, { filePath: spec }))[0].errorCount, 0);
});

// The shapes people really write: a wrapper around the read, a fallback, a plain assignment.
test('a stored state read is reported through a wrapper, a fallback or an assignment', async () => {
  const filePath = path.join(ROOT, 'packages', PACKAGES[0], 'tests', 'new.spec.ts');
  const reads = [
    "const t = (await page.locator('#x').innerText()).trim();",
    "const t = (await page.locator('#x').textContent()) ?? '';",
    "const n = Number(await page.locator('#x').inputValue());",
    "let v; v = await page.locator('#x').isVisible();",
  ];
  for (const read of reads) {
    const [result] = await linter().lintText(`import { test } from '@playwright/test';\ntest('t', async ({ page }) => {\n  ${read}\n});\n`, { filePath });
    assert.deepEqual(result.messages.map((m) => m.ruleId), ['no-restricted-syntax'], read);
  }
});
