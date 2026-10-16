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
  return page.evaluate(() => [...document.querySelectorAll('input, textarea')]
    .filter((el) => el.type !== 'hidden' && el.placeholder)
    .filter((el) => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
    .map((el) => ({ rule: 'placeholder-only-label', criteria: ['3.3.2'], level: 'A', target: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}[placeholder="${el.placeholder}"]`, label: el.placeholder })));
}
