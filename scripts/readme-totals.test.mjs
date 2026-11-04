// The sentence "N packages, about N automated tests and checks" appears in README.md and
// TECHNICAL.md, and again in the profile README (badge, proof line, project row). It went stale on
// 2026-11-04: a package's count changed and only its table row was edited, so the sentence was
// about 5% under what the Checks column added up to (found in the profile pull request's review).
//
// "About" is a hand-rounded figure, and always has been, so this checks the figure is a sensible
// one, not an exact match: a multiple of 10, no more than the column adds up to, and within 2% of
// it. The column is added up as written, every number in each cell ("17 + 39-step live check"
// is 56), the way the profile's figure has always been made. The profile README is another
// repository: it is updated by hand, and this failure message says so.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const packageLines = (readme) => readme.split('\n').filter((line) => /^\| \[[^\]]+\]\(packages\//.test(line));

// The Checks cell of each package row: "| [name](packages/name) | what it does | checks |".
export function checksCells(readme) {
  return packageLines(readme).map((line) => {
    const cells = line.split(/\s\|\s/);
    return cells[cells.length - 1].replace(/\|\s*$/, '').trim();
  });
}

export function total(cells) {
  return cells.flatMap((cell) => [...cell.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, '')))).reduce((a, b) => a + b, 0);
}

const readme = read('README.md');

// package name -> its Checks cell, for the rows of one file.
const cellsByPackage = (text) => Object.fromEntries(packageLines(text).map((line) => [line.match(/\(packages\/([^)]+)\)/)[1], checksCells(line)[0]]));

test('every package folder has one row in the README tables', () => {
  const folders = fs.readdirSync(path.join(ROOT, 'packages')).filter((d) => fs.statSync(path.join(ROOT, 'packages', d)).isDirectory());
  const rows = packageLines(readme).map((line) => line.match(/\(packages\/([^)]+)\)/)[1]);
  assert.deepEqual([...rows].sort(), folders.sort());
});

test('the README and the technical guide state the package count, and a total close to what the tables add up to', () => {
  const sum = total(checksCells(readme));
  const rows = packageLines(readme).length;
  for (const file of ['README.md', 'TECHNICAL.md']) {
    const match = read(file).match(/(\d+) packages, about ([\d,]+) automated tests and checks/);
    assert.ok(match, `${file} has the sentence "N packages, about N automated tests and checks"`);
    assert.equal(Number(match[1]), rows, `${file}: package count`);
    const said = Number(match[2].replace(/,/g, ''));
    const hint = `the Checks column adds up to ${sum.toLocaleString('en-US')}; update the sentence in README.md and TECHNICAL.md, and the profile README (badge, proof line)`;
    assert.equal(said % 10, 0, `${file}: round the figure to ten. ${hint}`);
    assert.ok(said <= sum, `${file}: says ${said}, more than the tables hold. ${hint}`);
    assert.ok(said >= sum * 0.98, `${file}: says ${said}, more than 2% under. ${hint}`);
  }
});

test('TECHNICAL.md gives every package the same Checks cell as the README', () => {
  const [readmeCells, guideCells] = [cellsByPackage(readme), cellsByPackage(read('TECHNICAL.md'))];
  assert.deepEqual(Object.keys(guideCells).sort(), Object.keys(readmeCells).sort(), 'both files list the same packages');
  for (const [name, cell] of Object.entries(readmeCells)) assert.equal(guideCells[name], cell, `${name}: README.md and TECHNICAL.md disagree`);
});

test('the total adds every number in the Checks column, thousands separators included', () => {
  assert.equal(total(['328 + 17 properties + ZAP scan']), 345);
  assert.equal(total(['9 scenarios + 4', '1,000']), 1013);
});
