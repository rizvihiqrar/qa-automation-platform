// A195: the failure the stored-state rule exists for, shown in a real browser. A button is
// added to the page when the test says so. Reading its state into a variable gives the page
// as it was before, so the branch taken is the old one even though the button is there a
// moment later. Asserting on the Locator waits for it. Nothing here depends on how fast
// the machine is: the page changes only when the test changes it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, expect } from '@playwright/test';

const PAGE = `<div id="area"></div><script>
  window.show = () => { document.getElementById('area').innerHTML = '<button id="late">Pay now</button>'; };
</script>`;

let browser;
let page;
let missing = '';
before(async () => {
  try {
    browser = await chromium.launch();
    page = await browser.newPage();
  } catch (error) {
    // CI installs the browser, so a missing one there is a failure. Locally the lint tests still run.
    if (process.env.CI) throw error;
    missing = 'Chromium is not installed here: run `npx playwright install chromium`';
  }
});
after(async () => { await browser?.close(); });

test('the stored read takes the stale branch: the button is there a moment later', async (t) => {
  if (missing) return t.skip(missing);
  await page.setContent(PAGE);
  const late = page.locator('#late');
  const visible = await late.isVisible(); // the page as it is now: no button yet
  await page.evaluate(() => window.show()); // the page changes
  const branch = visible ? 'button shown' : 'button missing';
  assert.equal(branch, 'button missing', 'the stored read still says missing');
  await expect(late).toBeVisible(); // the same element, now there
});

test('the Locator version waits for a button that appears later, and passes', async (t) => {
  if (missing) return t.skip(missing);
  await page.setContent(PAGE);
  const late = page.locator('#late');
  await page.evaluate(() => setTimeout(() => window.show(), 400));
  await expect(late).toBeVisible();
  await expect(late).toHaveText('Pay now');
});

test('the stored text goes stale the same way', async (t) => {
  if (missing) return t.skip(missing);
  await page.setContent(PAGE);
  const area = page.locator('#area');
  const text = await area.textContent(); // empty now
  await page.evaluate(() => window.show());
  assert.equal(text, '');
  await expect(area).toHaveText('Pay now'); // what it says now
});
