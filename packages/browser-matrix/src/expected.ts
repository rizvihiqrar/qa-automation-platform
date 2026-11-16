import type { BrowserName } from './matrix.ts';

// What each browser is expected to answer to each probe: the answers recorded on the day the package was
// built, with the Playwright 1.65 builds (Chromium 149, Firefox 150, WebKit 27). The tests pass while a
// browser still answers this way and fail the day one changes, so a browser update that changes behaviour
// is noticed instead of found by a user. Where an answer is the same everywhere it is written once per
// browser anyway, so the table can be read without knowing which ones agree.
//
// Playwright's WebKit is a port, built differently for each operating system and not the Safari on a Mac,
// so an answer may be given per platform ('linux' is what CI runs, 'win32' is the author's PC).
export type Platform = 'linux' | 'win32' | 'darwin';
export type Expected = string | Partial<Record<Platform, string>>;

const same = (answer: string): Record<BrowserName, Expected> => ({ chromium: answer, firefox: answer, webkit: answer });

export const EXPECTED: Record<string, Record<BrowserName, Expected>> = {
  'input-types': { chromium: 'date,month,week,time,datetime-local,color', firefox: 'date,time,datetime-local,color', webkit: { win32: '', linux: 'UNKNOWN' } },
  'required-message': { chromium: 'Please fill out this field.', firefox: 'Please fill out this field.', webkit: 'Fill out this field' },
  'number-message': { chromium: 'Value must be greater than or equal to 1.', firefox: 'Please select a value that is no less than 1.', webkit: { win32: 'range underflow', linux: 'UNKNOWN' } },
  'date-parse': same('parsed'),
  'date-format': same('2026-11-16, 4:05:00 p.m.'),
  'currency-format': { chromium: "CHF\\u00A01'234.50", firefox: "CHF\\u00A01'234.50", webkit: 'CHF\\u00A01\\u2019234.50' },
  'css-has': same('true'),
  'css-anchor': same('true'),
  'css-field-sizing': same('true'),
  'show-picker': same('true'),
  'tab-order': { chromium: 'first', firefox: 'first', webkit: { win32: 'second', linux: 'UNKNOWN' } },
};

/** The answer expected from a browser on a platform, or undefined when none is recorded for that platform. */
export function expectedAnswer(id: string, browser: BrowserName, platform: string): string | undefined {
  const value = EXPECTED[id]?.[browser];
  return typeof value === 'string' || value === undefined ? value : value[platform as Platform];
}
