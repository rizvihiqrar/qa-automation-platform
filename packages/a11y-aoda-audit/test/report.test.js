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

test('buildFindings reports the upload checks with their own impact, criterion and fix', () => {
  const upload = [
    { rule: 'dropzone-no-keyboard-path', criteria: ['2.1.1'], level: 'A', target: '[data-dropzone]' },
    { rule: 'status-not-announced', criteria: ['4.1.3'], level: 'AA', target: '[data-status]' },
    { rule: 'focus-lost-after-delete', criteria: ['2.4.3'], level: 'A', target: 'ul button' },
  ];
  const findings = buildFindings([{ page: 'upload.html', axe: [], focus: [], placeholders: [], upload }]);
  assert.deepEqual(findings.map((f) => [f.rule, f.impact, f.criteria[0], f.count]), [
    ['dropzone-no-keyboard-path', 'critical', '2.1.1', 1],
    ['status-not-announced', 'serious', '4.1.3', 1],
    ['focus-lost-after-delete', 'moderate', '2.4.3', 1],
  ]);
  assert.equal(scName('2.1.1'), 'Keyboard');
  assert.equal(scName('4.1.3'), 'Status Messages (WCAG 2.1)');
  assert.equal(scName('2.4.3'), 'Focus Order');
  for (const f of findings) assert.notEqual(fixFor(f.rule), 'See the rule documentation.');
  assert.match(toMarkdown({ version: 'before', pages: [{}], findings }), /Drop zone has no keyboard path \| 2\.1\.1 Keyboard \| A/);
});

test('a page without an upload key still builds findings (the older pages have none)', () => {
  assert.deepEqual(buildFindings([{ page: 'a.html', axe: [], focus: [], placeholders: [] }]), []);
});

test('the report claims the upload checks only when a page ran them, and says the status check is WCAG 2.1', () => {
  const withUpload = toMarkdown({ version: 'before', pages: [{ page: 'upload.html', upload: [] }], findings: [] });
  const without = toMarkdown({ version: 'before', pages: [{ page: 'index.html' }], findings: [] });
  assert.match(withUpload, /drag and drop upload.*the status check is WCAG 2.1/);
  assert.doesNotMatch(without, /drag and drop|upload/);
});

test('an unknown rule is reported under its own id, not as a placeholder problem', () => {
  const [f] = buildFindings([{ page: 'x.html', axe: [], focus: [], placeholders: [], upload: [{ rule: 'some-new-rule', criteria: ['2.1.1'], level: 'A', target: '#a' }] }]);
  assert.equal(f.help, 'some-new-rule');
});
