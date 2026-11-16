import { test, expect } from '@playwright/test';
import { axeViolations, focusIssues, placeholderOnlyFields, dropzoneKeyboardPath, addSampleFile, statusNotAnnounced, focusLostAfterDelete } from '../src/checks.js';

// The "before" site has known defects; each page must report exactly these axe rules.
const EXPECTED_BEFORE = {
  'index.html': ['color-contrast', 'document-title', 'html-has-lang', 'image-alt', 'link-name'],
  'product.html': ['button-name', 'select-name'],
  'checkout.html': ['color-contrast'],
};
const EXPECTED_FOCUS = { 'index.html': 3, 'product.html': 3, 'checkout.html': 4 };

test.describe('before: the audit finds every planted defect', () => {
  for (const [name, rules] of Object.entries(EXPECTED_BEFORE)) {
    test(`${name} reports exactly ${rules.join(', ')}`, async ({ page }) => {
      await page.goto(`/before/${name}`);
      const found = (await axeViolations(page)).map((v) => v.rule).sort();
      expect(found).toEqual(rules);
    });

    test(`${name} has ${EXPECTED_FOCUS[name]} element(s) with no visible focus`, async ({ page }) => {
      await page.goto(`/before/${name}`);
      expect(await focusIssues(page)).toHaveLength(EXPECTED_FOCUS[name]);
    });
  }

  test('axe accepts placeholder-only fields; the extra check catches all three', async ({ page }) => {
    await page.goto('/before/checkout.html');
    const axeRules = (await axeViolations(page)).map((v) => v.rule);
    expect(axeRules).not.toContain('label');
    const fields = await placeholderOnlyFields(page);
    expect(fields.map((f) => f.label)).toEqual(['Full name', 'Email', 'Postal code']);
  });
});

test.describe('after: the remediated site is clean', () => {
  for (const name of Object.keys(EXPECTED_BEFORE)) {
    test(`${name} has no WCAG A/AA violations, focus issues or placeholder-only fields @smoke`, async ({ page }) => {
      await page.goto(`/after/${name}`);
      expect(await axeViolations(page)).toEqual([]);
      expect(await focusIssues(page)).toEqual([]);
      expect(await placeholderOnlyFields(page)).toEqual([]);
    });
  }
});

// A495: the drag and drop upload page. axe sees the unnamed delete button, but only once a file
// has been added; the keyboard path, the announced status and where focus lands need the page to
// be used, so they have their own checks.
test.describe('upload page: before has four planted defects, after has none', () => {
  test('before: no keyboard path reaches the file picker', async ({ page }) => {
    await page.goto('/before/upload.html');
    const issues = await dropzoneKeyboardPath(page);
    expect(issues.map((i) => [i.rule, i.criteria[0]])).toEqual([['dropzone-no-keyboard-path', '2.1.1']]);
  });

  test('before: the status after an upload is not a live region', async ({ page }) => {
    await page.goto('/before/upload.html');
    await addSampleFile(page);
    expect(await page.locator('[data-status]').textContent()).toBe('1 photo(s) added');
    expect((await statusNotAnnounced(page)).map((i) => i.rule)).toEqual(['status-not-announced']);
  });

  test('before: axe finds the unnamed delete button, but only after a file is added', async ({ page }) => {
    await page.goto('/before/upload.html');
    expect(await axeViolations(page)).toEqual([]);
    await addSampleFile(page);
    expect((await axeViolations(page)).map((v) => v.rule)).toEqual(['button-name']);
  });

  test('before: deleting the focused button leaves focus on the page body', async ({ page }) => {
    await page.goto('/before/upload.html');
    await addSampleFile(page);
    expect((await focusLostAfterDelete(page)).map((i) => i.rule)).toEqual(['focus-lost-after-delete']);
  });

  test('after: a keyboard user reaches the choose button and the picker opens @smoke', async ({ page }) => {
    await page.goto('/after/upload.html');
    await page.keyboard.press('Tab'); // first Tab on a fresh page
    await expect(page.getByRole('button', { name: 'Choose photos' })).toBeFocused();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    expect(await chooser).toBeTruthy();
    expect(await dropzoneKeyboardPath(page)).toEqual([]);
  });

  test('after: the status is announced, the delete button is named and focus moves to the choose button @smoke', async ({ page }) => {
    await page.goto('/after/upload.html');
    await addSampleFile(page);
    expect(await statusNotAnnounced(page)).toEqual([]);
    expect(await axeViolations(page)).toEqual([]);
    expect(await focusIssues(page)).toEqual([]);
    await expect(page.getByRole('button', { name: 'Remove room.jpg' })).toBeVisible();
    expect(await focusLostAfterDelete(page)).toEqual([]);
    await expect(page.getByRole('button', { name: 'Choose photos' })).toBeFocused();
    await expect(page.locator('[data-status]')).toHaveText('No photos');
  });

  test('a page with no drop zone is not flagged by the upload checks', async ({ page }) => {
    await page.goto('/before/checkout.html');
    expect(await dropzoneKeyboardPath(page)).toEqual([]);
    expect(await statusNotAnnounced(page)).toEqual([]);
    expect(await focusLostAfterDelete(page)).toEqual([]);
  });
});

// Two ways a page can look right and still fail a user (found in review of A495).
test.describe('upload checks: harder cases', () => {
  const page = (zone, status) => `<!doctype html><html lang="en"><title>t</title><main>
    <div data-dropzone>${zone}</div><input type="file" hidden id="f"><ul></ul>${status}</main>
    <script>document.getElementById('f').addEventListener('change', () => { document.querySelector('[data-status]').textContent = 'added'; });</script>`;

  test('only a button (or the file input) makes a keyboard path: a link or plain text in the drop zone does not', async ({ page: p }) => {
    for (const [zone, expected] of [
      ['<a href="#help">Help</a><p>Drop photos here</p>', ['dropzone-no-keyboard-path']],
      ['<p>Drop photos here</p>', ['dropzone-no-keyboard-path']],
      ['<button type="button">Choose</button>', []],
    ]) {
      await p.setContent(page(zone, '<p data-status></p>'));
      expect((await dropzoneKeyboardPath(p)).map((i) => i.rule), zone).toEqual(expected);
    }
  });

  test('a status line that becomes a live region only when its text changes is not announced', async ({ page: p }) => {
    await p.setContent(page('<button type="button">Choose</button>', '<p data-status></p>'));
    // The role arrives together with the text, which is too late for a screen reader to announce it.
    await p.evaluate(() => document.getElementById('f').addEventListener('change', () => document.querySelector('[data-status]').setAttribute('role', 'status')));
    await addSampleFile(p);
    expect((await statusNotAnnounced(p)).map((i) => i.rule)).toEqual(['status-not-announced']);
  });

  test('a status line that is a live region from the start is announced', async ({ page: p }) => {
    await p.setContent(page('<button type="button">Choose</button>', '<p data-status role="status"></p>'));
    await addSampleFile(p);
    expect(await statusNotAnnounced(p)).toEqual([]);
  });
});
