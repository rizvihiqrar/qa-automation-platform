// Page checks: axe (WCAG 2.0 A/AA rules) plus two checks axe doesn't cover well.
import { AxeBuilder } from '@axe-core/playwright';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa'];

export async function axeViolations(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    tags: v.tags,
    help: v.help,
    targets: v.nodes.map((n) => n.target.join(' ')),
  }));
}

// WCAG 2.4.7 Focus Visible: tab through the page and record every element whose
// focus state has no outline and no box-shadow.
export async function focusIssues(page) {
  const focusable = await page.locator('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').count();
  const seen = new Set();
  const issues = [];
  await page.locator('body').focus();
  for (let i = 0; i < focusable + 1; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const shadow = s.boxShadow && s.boxShadow !== 'none';
      // A path from the nearest id (or <body>), so two "first link in its card"
      // elements in different cards don't look like the same element.
      const parts = [];
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.id) { parts.unshift(`#${n.id}`); break; }
        const index = [...n.parentElement.children].filter((c) => c.tagName === n.tagName).indexOf(n) + 1;
        parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${index})`);
      }
      const id = parts.join(' > ');
      return { id, visible: outline || shadow, label: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40) };
    });
    if (!info || seen.has(info.id)) continue;
    seen.add(info.id);
    if (!info.visible) issues.push({ rule: 'focus-not-visible', criteria: ['2.4.7'], level: 'AA', target: info.id, label: info.label });
  }
  return issues;
}

// WCAG 3.3.2: a field whose only label is a placeholder. axe accepts a placeholder
// as an accessible name, but the hint disappears as soon as someone types.
export async function placeholderOnlyFields(page) {
  return page.evaluate(() => [.../** @type {NodeListOf<HTMLInputElement | HTMLTextAreaElement>} */ (document.querySelectorAll('input, textarea'))]
    .filter((el) => el.type !== 'hidden' && el.placeholder)
    .filter((el) => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
    .map((el) => ({ rule: 'placeholder-only-label', criteria: ['3.3.2'], level: 'A', target: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}[placeholder="${el.placeholder}"]`, label: el.placeholder })));
}

// Drag and drop upload (A495). axe cannot see these three, because they depend on what happens
// after a Tab press or an upload. A page marks its drop zone with data-dropzone and its status
// line with data-status.
export const SAMPLE_FILE = { name: 'room.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a real image') };

// WCAG 2.1.1 Keyboard: a person who cannot use a mouse must be able to reach something that opens
// the file picker. Tabs through the page and looks for focus on the drop zone, inside it, or on
// the file input itself. A div that only listens for clicks is never reached.
export async function dropzoneKeyboardPath(page) {
  if (!(await page.locator('[data-dropzone]').count())) return [];
  const focusable = await page.locator('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').count();
  await page.locator('body').focus();
  for (let i = 0; i < focusable + 1; i++) {
    await page.keyboard.press('Tab');
    const reached = await page.evaluate(() => {
      const el = document.activeElement;
      // Something that can open the picker: the file input, or a button inside the drop zone.
      // A decorative element in the zone does not count, and neither does the zone itself unless it is a button.
      return !!el && el !== document.body && (el.matches('input[type=file]') || (!!el.closest('[data-dropzone]') && el.matches('button, [role="button"]')));
    });
    if (reached) return [];
  }
  return [{ rule: 'dropzone-no-keyboard-path', criteria: ['2.1.1'], level: 'A', target: '[data-dropzone]', label: 'drop zone' }];
}

// Adds the sample file through the file input, the way the file picker would.
// Live regions: the status line must already be one before it changes, because a region created
// together with its text is not announced by screen readers. addSampleFile notes this just before adding.
const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
export async function addSampleFile(page) {
  const before = await page.evaluate((live) => {
    const el = document.querySelector('[data-status]');
    /** @type {any} */ (window).__statusWasLive = !!el && !!el.closest(live);
    return el ? el.textContent : '';
  }, LIVE);
  await page.locator('input[type=file]').setInputFiles(SAMPLE_FILE);
  await page.waitForFunction((text) => { const el = document.querySelector('[data-status]'); return !!el && el.textContent !== text; }, before);
}

// WCAG 4.1.3 Status Messages (a WCAG 2.1 criterion, beyond the 2.0 AA that AODA requires, but a screen
// reader user needs it): the line that says what happened must be a live region, and must have been one
// before its text changed, or a screen reader says nothing. Call it after addSampleFile.
export async function statusNotAnnounced(page) {
  return page.evaluate((live) => {
    const el = document.querySelector('[data-status]');
    if (!el || !el.textContent.trim()) return [];
    const announced = !!el.closest(live) && /** @type {any} */ (window).__statusWasLive !== false;
    return announced ? [] : [{ rule: 'status-not-announced', criteria: ['4.1.3'], level: 'AA', target: '[data-status]', label: el.textContent.trim().slice(0, 40) }];
  }, LIVE);
}

// WCAG 2.4.3 Focus Order: pressing Enter on a delete button removes it, and the focus must land
// somewhere sensible, not on the page body (where the next Tab starts again from the top). Call it
// last: it deletes the first file in the list.
export async function focusLostAfterDelete(page) {
  const button = page.locator('[data-dropzone] ~ ul button').first();
  if (!(await button.count())) return [];
  await button.focus();
  await page.keyboard.press('Enter');
  const lost = await page.evaluate(() => !document.activeElement || document.activeElement === document.body);
  return lost ? [{ rule: 'focus-lost-after-delete', criteria: ['2.4.3'], level: 'A', target: 'ul button', label: 'delete button' }] : [];
}
