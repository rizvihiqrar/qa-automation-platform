import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criteriaFromTags, scName, fixFor, AODA_NOTE } from '../src/wcag.js';
import { buildFindings, toMarkdown } from '../src/report.js';

test('criteriaFromTags reads success criteria and level from axe tags', () => {
  assert.deepEqual(criteriaFromTags(['cat.color', 'wcag2aa', 'wcag143']), { criteria: ['1.4.3'], level: 'AA' });
  assert.deepEqual(criteriaFromTags(['wcag2a', 'wcag244', 'wcag412']), { criteria: ['2.4.4', '4.1.2'], level: 'A' });
  assert.deepEqual(criteriaFromTags(['best-practice']), { criteria: [], level: null });
});

test('scName and fixFor cover the rules used here and fall back safely', () => {
  assert.equal(scName('1.4.3'), 'Contrast (Minimum)');
  assert.equal(scName('9.9.9'), '');
  assert.match(fixFor('image-alt'), /alt text/);
  assert.equal(fixFor('unknown-rule'), 'See the rule documentation.');
});

const pages = [
  { page: 'index.html', axe: [{ rule: 'image-alt', impact: 'critical', tags: ['wcag2a', 'wcag111'], help: 'Images must have alternative text', targets: ['img:nth-of-type(1)', 'img:nth-of-type(2)'] }], focus: [{ rule: 'focus-not-visible', criteria: ['2.4.7'], level: 'AA', target: 'a' }], placeholders: [] },
  { page: 'checkout.html', axe: [], focus: [], placeholders: [{ rule: 'placeholder-only-label', criteria: ['3.3.2'], level: 'A', target: '#email', label: 'Email' }] },
];

test('buildFindings groups by rule, counts instances, and sorts by impact', () => {
  const findings = buildFindings(pages);
  assert.deepEqual(findings.map((f) => [f.rule, f.impact, f.count, f.pages.join()]), [
    ['image-alt', 'critical', 2, 'index.html'],
    ['focus-not-visible', 'serious', 1, 'index.html'],
    ['placeholder-only-label', 'moderate', 1, 'checkout.html'],
  ]);
  assert.deepEqual(findings[0].criteria, ['1.1.1']);
});

test('toMarkdown lists each issue with WCAG criterion, level and fix, plus the AODA context', () => {
  const md = toMarkdown({ version: 'before', pages, findings: buildFindings(pages) });
  assert.match(md, /\*\*3 issue type\(s\), 4 instance\(s\)\.\*\*/);
  assert.match(md, /\| critical \| Images must have alternative text \| 1\.1\.1 Non-text Content \| A \| 2 \| index\.html \|/);
  assert.match(md, /2\.4\.7 Focus Visible \| AA/);
  assert.match(md, /## AODA context/);
  assert.ok(md.includes(AODA_NOTE));
});

test('a clean audit says so', () => {
  assert.match(toMarkdown({ version: 'after', pages: [], findings: [] }), /\*\*No issues found\.\*\*/);
});

test('the AODA note names the standard, the threshold and that it is not legal advice', () => {
  assert.match(AODA_NOTE, /O\. Reg\. 191\/11/);
  assert.match(AODA_NOTE, /WCAG 2\.0 Level AA/);
  assert.match(AODA_NOTE, /50 or more employees/);
  assert.match(AODA_NOTE, /not legal advice/);
});
