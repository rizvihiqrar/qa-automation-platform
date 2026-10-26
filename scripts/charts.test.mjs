// The Day 59 charts (scripts/charts.mjs) must stay true to their sources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LOGIN, THEMES, readScoreboard, renderAll } from './charts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the committed SVG files are what scripts/charts.mjs draws today', () => {
  for (const [file, svg] of Object.entries(renderAll())) assert.equal(read(file).replace(/\r\n/g, '\n'), svg, `${file} is stale: run node scripts/charts.mjs`);
});

test('the login chart uses the figures of the write-up, and never labels 67 ms as the login time', () => {
  const rca = read('docs/rca/01-login-hashing-blocked-the-api.md');
  assert.match(rca, /\| `list products` p95 \| 67–84 ms \| \*\*1\.0 ms\*\* \|/);
  assert.match(rca, /took about 70 ms/);
  assert.deepEqual(LOGIN, { hashMs: 70, listBeforeP95: 67, listAfterP95: 1 });
  const svg = renderAll()['docs/assets/login-before-after-light.svg'];
  assert.match(svg, /one password hash, about 70 ms/);
  assert.match(svg, /list products, p95/);
  assert.doesNotMatch(svg, /login[^<]{0,40}67 ms|67 ms[^<]{0,40}login/i);
});

test('the heatmap has 7 mistakes by 9 kinds of check, and every number is the table\'s', () => {
  const { columns, rows } = readScoreboard();
  assert.equal(rows.length, 7);
  assert.equal(columns.length, 9);
  const svg = renderAll()['docs/assets/scoreboard-heatmap-light.svg'];
  // The counts, row by row and left to right, are the 19 px numbers in the SVG.
  const fromTable = rows.flatMap((r) => r.cells).filter((c) => /^\d+$/.test(c));
  const fromSvg = [...svg.matchAll(/font-size="19"[^>]*>(\d+)<\/text>/g)].map((m) => m[1]);
  assert.ok(fromTable.length > 0);
  assert.deepEqual(fromSvg, fromTable);
  // and a tick is drawn exactly where the table has one
  assert.equal((svg.match(/>✔</g) ?? []).length, rows.flatMap((r) => r.cells).filter((c) => c === '✔').length);
  assert.equal((svg.match(/<rect x="\d+" y="\d+" width="64"/g) ?? []).length, 7 * 9);
});

test('both docs show their chart in a light and a dark version', () => {
  for (const [doc, chart] of [['docs/rca/01-login-hashing-blocked-the-api.md', 'login-before-after'], ['docs/ai-written-code/scoreboard.md', 'scoreboard-heatmap']]) {
    const md = read(doc);
    assert.ok(md.includes(`${chart}-light.svg`) && md.includes(`${chart}-dark.svg`), doc);
  }
});

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('the heatmap numbers (large text, 3 or more) and the chart text (4.5 or more) are readable in both themes', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    // The cell numbers are 19 px bold, which WCAG counts as large text (3 or more).
    t.steps.forEach((fill, i) => assert.ok(contrast(fill, t.stepText[i]) >= 3, `${name} step ${i + 1}: ${contrast(fill, t.stepText[i]).toFixed(2)}`));
    for (const ink of [t.text, t.text2]) assert.ok(contrast(t.surface, ink) >= 4.5, `${name} ${ink} on the surface`);
  }
});
