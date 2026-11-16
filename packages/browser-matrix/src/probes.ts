import type { Page } from '@playwright/test';

// A probe asks one browser one question about something browsers are known to handle differently,
// and answers with a short string. It reads nothing from the network and nothing from the machine,
// so the answer depends on the browser and its version only.
export interface Probe {
  id: string;
  /** What is being asked, in plain words. */
  question: string;
  ask: (page: Page) => Promise<string>;
}

// The page every probe runs on: a form and a dialog, which is all the probes need.
export const PAGE_HTML = `<!doctype html><html lang="en"><title>Browser matrix</title><body>
  <a id="first" href="#x">A link</a><button id="second" type="button">A button</button>
  <form><input id="name" name="name" required><input id="amount" type="number" min="1"></form>
  <dialog id="dialog">Hello</dialog>
</body></html>`;

// Characters that look like a space show up as code points, so a difference is visible in the table.
const visible = (text: string) => [...text].map((c) => (c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32 ? `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}` : c)).join('');

export const PROBES: Probe[] = [
  {
    id: 'input-types',
    question: 'Which of the date, month, week, time, datetime-local and color input types does the browser really offer? (An unknown type turns into a plain text box.)',
    ask: (page) => page.evaluate(() => ['date', 'month', 'week', 'time', 'datetime-local', 'color'].filter((type) => { const i = document.createElement('input'); i.type = type; return i.type === type; }).join(',')),
  },
  {
    id: 'required-message',
    question: 'What does the browser say about an empty required field? (The words are the browser\'s, not the page\'s.)',
    ask: (page) => page.evaluate(() => (document.getElementById('name') as HTMLInputElement).validationMessage),
  },
  {
    id: 'number-message',
    question: 'What does the browser say about a number below the minimum?',
    ask: (page) => page.evaluate(() => { const i = document.getElementById('amount') as HTMLInputElement; i.value = '0'; return i.validationMessage; }),
  },
  {
    id: 'date-parse',
    question: 'Is "2026-11-16 12:00" (a space instead of a T) a date?',
    ask: (page) => page.evaluate(() => (Number.isNaN(Date.parse('2026-11-16 12:00')) ? 'invalid' : 'parsed')),
  },
  {
    id: 'date-format',
    question: 'How does the browser write a date and time for en-CA? (Spaces that look the same can be different characters.)',
    ask: async (page) => visible(await page.evaluate(() => new Date(Date.UTC(2026, 10, 16, 16, 5)).toLocaleString('en-CA', { timeZone: 'UTC' }))),
  },
  {
    id: 'currency-format',
    question: 'How does the browser write 1234.5 as Swiss francs in de-CH?',
    ask: async (page) => visible(await page.evaluate(() => new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' }).format(1234.5))),
  },
  {
    id: 'css-has',
    question: 'Does CSS understand :has()?',
    ask: (page) => page.evaluate(() => String(CSS.supports('selector(:has(a))'))),
  },
  {
    id: 'css-anchor',
    question: 'Does CSS understand anchor positioning (anchor-name)?',
    ask: (page) => page.evaluate(() => String(CSS.supports('anchor-name: --a'))),
  },
  {
    id: 'css-field-sizing',
    question: 'Does CSS understand field-sizing: content (a text box that grows with its text)?',
    ask: (page) => page.evaluate(() => String(CSS.supports('field-sizing: content'))),
  },
  {
    id: 'show-picker',
    question: 'Can a script open an input\'s picker (showPicker)?',
    ask: (page) => page.evaluate(() => String('showPicker' in HTMLInputElement.prototype)),
  },
  {
    id: 'tab-order',
    question: 'On a fresh page, which element does the first Tab press reach?',
    ask: async (page) => {
      await page.goto('about:blank');
      await page.setContent(PAGE_HTML);
      await page.keyboard.press('Tab');
      return page.evaluate(() => document.activeElement?.id ?? 'nothing');
    },
  },
];
