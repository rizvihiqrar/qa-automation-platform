// Maps axe results to WCAG success criteria and adds plain-language fixes.

const SC_NAMES = {
  '1.1.1': 'Non-text Content',
  '1.3.1': 'Info and Relationships',
  '1.4.3': 'Contrast (Minimum)',
  '2.4.2': 'Page Titled',
  '2.4.4': 'Link Purpose (In Context)',
  '2.4.7': 'Focus Visible',
  '3.1.1': 'Language of Page',
  '3.3.2': 'Labels or Instructions',
  '4.1.2': 'Name, Role, Value',
};

const FIXES = {
  'image-alt': 'Give every informative image an alt text that says what it shows; use alt="" for decorative images.',
  'color-contrast': 'Make normal text at least 4.5:1 against its background (large text 3:1).',
  'document-title': 'Give each page a unique <title> that says what the page is.',
  'html-has-lang': 'Set the page language, e.g. <html lang="en">, so screen readers pronounce it correctly.',
  'link-name': 'Give every link text or an aria-label that says where it goes.',
  'button-name': 'Give icon-only buttons an aria-label, e.g. "Add to cart".',
  'select-name': 'Connect a visible <label for="..."> to every select.',
  label: 'Connect a visible <label for="..."> to every form field.',
  'placeholder-only-label': 'Add a visible label; a placeholder disappears as soon as someone types.',
  'focus-not-visible': 'Do not remove the focus outline; style :focus-visible with a clear outline instead.',
};

// axe tags like "wcag143" -> "1.4.3"; "wcag2a" / "wcag2aa" give the level.
export function criteriaFromTags(tags = []) {
  const sc = tags.map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t)).filter(Boolean).map((m) => `${m[1]}.${m[2]}.${m[3]}`);
  const level = tags.includes('wcag2aa') || tags.includes('wcag21aa') ? 'AA' : tags.includes('wcag2a') || tags.includes('wcag21a') ? 'A' : null;
  return { criteria: [...new Set(sc)], level };
}

export const scName = (sc) => SC_NAMES[sc] ?? '';
export const fixFor = (rule) => FIXES[rule] ?? 'See the rule documentation.';

export const AODA_NOTE = [
  "Ontario's Accessibility for Ontarians with Disabilities Act (AODA), through its Integrated Accessibility Standards Regulation (O. Reg. 191/11),",
  'requires designated public sector organizations and businesses with 50 or more employees in Ontario to make public websites meet',
  'WCAG 2.0 Level AA, with exceptions for live captions (1.2.4) and pre-recorded audio descriptions (1.2.5).',
  'This audit checks the automatically testable WCAG 2.0 A and AA rules; a full conformance review also needs manual and assistive-technology testing.',
  'It is a testing aid, not legal advice.',
].join(' ');
