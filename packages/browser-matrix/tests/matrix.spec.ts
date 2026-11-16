import { test, expect } from '@playwright/test';
import { PAGE_HTML, PROBES } from '../src/probes.ts';
import { EXPECTED, expectedAnswer } from '../src/expected.ts';
import { BROWSERS, differing, toTable, type Answers } from '../src/matrix.ts';

// One test per probe and browser: the browser must still answer the way the table in src/expected.ts says.
// A difference between browsers is not a failure (it is the point); a browser changing its answer is.
for (const probe of PROBES) {
  test(`${probe.id}: ${probe.question} @regression`, async ({ page, browserName }) => {
    await page.setContent(PAGE_HTML);
    const expected = expectedAnswer(probe.id, browserName, process.platform);
    test.skip(expected === undefined, `no answer is recorded for ${browserName} on ${process.platform}`);
    expect(await probe.ask(page), `${browserName} on ${process.platform}`).toBe(expected);
  });
}

// The rest does not depend on the browser, so it runs in the first project only.
test.describe('the table', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'browser-independent');

  test('every probe has an answer recorded for all three browsers, and nothing else is recorded', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(PROBES.map((p) => p.id).sort());
    for (const probe of PROBES) expect(Object.keys(EXPECTED[probe.id] ?? {}).sort(), probe.id).toEqual([...BROWSERS].sort());
  });

  test('probe ids are unique', () => {
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(PROBES.length);
  });

  const made: Answers = {
    a: { chromium: '1', firefox: '1', webkit: '1' },
    b: { chromium: '1', firefox: '2', webkit: '1' },
  };

  test('differing() names the probes the browsers answer differently', () => {
    expect(differing(made)).toEqual(['b']);
    expect(differing({})).toEqual([]);
  });

  test('toTable() writes one row per probe with a column per browser and marks the differences', () => {
    const table = toTable(made, [{ id: 'a', question: '', ask: async () => '' }, { id: 'b', question: '', ask: async () => '' }]).split('\n');
    expect(table[0]).toBe('| Probe | chromium | firefox | webkit | Same? |');
    expect(table[2]).toBe('| a | `1` | `1` | `1` | same |');
    expect(table[3]).toBe('| b | `1` | `2` | `1` | **differs** |');
  });

  test('expectedAnswer() reads a per-platform answer and returns nothing for a platform that has none', () => {
    expect(expectedAnswer('css-has', 'webkit', 'win32')).toBe('true');
    expect(expectedAnswer('tab-order', 'webkit', 'win32')).toBe('second');
    expect(expectedAnswer('tab-order', 'webkit', 'freebsd')).toBeUndefined();
  });
});
