// Keeps the root-cause write-ups in docs/rca honest: each one has every section,
// every relative link resolves, the index lists every write-up, and every
// regression test a write-up names still exists under that name. A renamed or
// deleted test fails here instead of leaving a page that points at nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'rca');
const read = (file) => fs.readFileSync(file, 'utf8');

const SECTIONS = ['Symptom', 'How it was found', 'Root cause', 'Fix', 'Regression tests', 'Prevention'];
const FACTS = ['Where', 'Found by', 'Impact', 'Fixed in'];

const pages = fs.readdirSync(DIR).filter((f) => /^\d{2}-.+\.md$/.test(f)).sort();

// The text of one "## Heading" section, up to the next "## ".
export function section(md, heading) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `## ${heading}`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

// "- [`path`](link) › `text`" lines: the test file and the exact text it must contain.
export function regressionTests(md) {
  return [...(section(md, 'Regression tests') ?? '').matchAll(/^- \[`([^`]+)`\]\(([^)]+)\) › `(.+)`$/gm)]
    .map(([, file, link, text]) => ({ file, link, text }));
}

// Relative Markdown links, without anchors; web links are skipped.
export function relativeLinks(md) {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
    .filter((l) => !/^[a-z]+:/i.test(l) && !l.startsWith('#'))
    .map((l) => l.split('#')[0]);
}

test('there are write-ups, and the index lists exactly those', () => {
  assert.ok(pages.length >= 5, `only ${pages.length} write-ups`);
  const indexed = relativeLinks(read(path.join(DIR, 'README.md'))).filter((l) => /^\d{2}-/.test(l));
  assert.deepEqual([...new Set(indexed)].sort(), pages);
});

for (const page of pages) {
  const md = read(path.join(DIR, page));

  test(`${page}: has a title, the facts table and every section`, () => {
    assert.match(md, /^# \S/);
    for (const fact of FACTS) assert.match(md, new RegExp(`^\\| \\*\\*${fact}\\*\\* \\| \\S`, 'm'), `missing fact: ${fact}`);
    for (const s of SECTIONS) assert.ok(section(md, s)?.trim(), `missing or empty section: ${s}`);
  });

  test(`${page}: every regression test it names still exists`, () => {
    const tests = regressionTests(md);
    assert.ok(tests.length > 0, 'no regression tests listed in the "- [`file`](link) › `text`" form');
    for (const { file, link, text } of tests) {
      assert.equal(path.resolve(DIR, link), path.resolve(ROOT, file), `link and path disagree for ${file}`);
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} does not exist`);
      assert.ok(read(path.join(ROOT, file)).includes(text), `${file} no longer contains: ${text}`);
    }
  });
}

test('every relative link in docs/rca resolves', () => {
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'TEMPLATE.md')) {
    for (const link of relativeLinks(read(path.join(DIR, file)))) {
      assert.ok(fs.existsSync(path.resolve(DIR, link)), `${file}: broken link ${link}`);
    }
  }
});

test('the parsers read the documented format and ignore other lines', () => {
  const md = '## Regression tests\n\n- [`a/b.js`](../../a/b.js) › `it works`\n- not a test line\n\n## Prevention\n- [`c.js`](c.js) › `x`';
  assert.deepEqual(regressionTests(md), [{ file: 'a/b.js', link: '../../a/b.js', text: 'it works' }]);
  assert.deepEqual(relativeLinks('[a](x.md#h) [b](https://e.com) [c](#top)'), ['x.md']);
  assert.equal(section('## A\nx\n## B\ny', 'A'), 'x');
});
