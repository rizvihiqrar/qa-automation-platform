// The small-bundle days (S4, S5, S6, ...) each get one row in ROADMAP.md. S5 was built and merged on
// 2026-11-12 but its row was never added, and nothing noticed until S6's own row went in next to it
// (found 2026-11-13). This fails when the S rows have a gap, so a missed row shows up on the next day's
// pull request at the latest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The numbers of the rows that start "| S<number> |" (a letter after the number, as in S2b, is not a new day). */
export function bundleDays(roadmap) {
  return roadmap.split(/\r?\n/).map((l) => l.match(/^\| S(\d+) \|/)).filter(Boolean).map((m) => Number(m[1]));
}

/** The day numbers missing between the first and the last row. */
export function gaps(days) {
  if (days.length === 0) return [];
  const have = new Set(days);
  const missing = [];
  for (let n = Math.min(...days); n <= Math.max(...days); n += 1) if (!have.has(n)) missing.push(n);
  return missing;
}

test('ROADMAP.md has a row for every small-bundle day between the first and the last (the break: a day built with no row)', () => {
  const days = bundleDays(fs.readFileSync(path.join(ROOT, 'ROADMAP.md'), 'utf8'));
  assert.ok(days.length > 0, 'ROADMAP.md has S rows');
  assert.deepEqual(gaps(days), [], `ROADMAP.md has no row for day(s) S${gaps(days).join(', S')}`);
});

test('the check sees a day with no row, and ignores a lettered day such as S2b', () => {
  assert.deepEqual(gaps(bundleDays('| S4 | a |\n| S6 | b |')), [5]);
  assert.deepEqual(gaps(bundleDays('| S4 | a |\n| S5 | b |\n| S6 | c |')), []);
  assert.deepEqual(gaps(bundleDays('| S4 | a |\n| S4b | x |\n| S5 | c |')), []);
  assert.deepEqual(gaps(bundleDays('| S4 | a |\r\n| S7 | b |')), [5, 6]);
  assert.deepEqual(gaps([]), []);
});
