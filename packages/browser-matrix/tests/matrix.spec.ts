import { test, expect } from '@playwright/test';
import { PAGE_HTML, PROBES } from '../src/probes.ts';
import { EXPECTED, expectedAnswer } from '../src/expected.ts';
import { BROWSERS, differing, toTable, type Answers } from '../src/matrix.ts';

// One test per probe and browser: the browser must still answer the way the table in src/expected.ts says.
// A difference between browsers is not a failure (it is the point); a browser changing its answer is.
for (const probe of PROBES) {
  // The title is the id, which does not change; the question can be reworded without losing the test's history.
  test(`${probe.id} @regression`, async ({ page, browserName }) => {
    test.info().annotations.push({ type: 'question', description: probe.question });
    await page.setContent(PAGE_HTML);
    const expected = expectedAnswer(probe.id, browserName, process.platform);
    // A platform with no recorded answer skips on a person's machine, but CI must never skip: that would be coverage lost with a green job.
    if (process.env.CI) expect(expected, `${browserName} has no recorded answer for ${probe.id} on ${process.platform}`).toBeDefined();
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

  test('the two platforms in use (CI runs linux, the author uses win32) have an answer for every probe and browser', () => {
    for (const platform of ['linux', 'win32']) {
      for (const probe of PROBES) for (const browser of BROWSERS) expect(expectedAnswer(probe.id, browser, platform), `${probe.id} ${browser} ${platform}`).toBeDefined();
    }
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
