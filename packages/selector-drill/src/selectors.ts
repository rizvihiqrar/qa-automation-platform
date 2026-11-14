// The drill: for each of 30 elements, a CSS selector and an XPath written by hand. The
// third way, the path a recorder writes, is made from the page itself (drill.ts).
// Most selectors follow the rules in the README (a stable attribute that says what the
// element IS). Five are weak on purpose, so the drill has something to show: they are
// marked `weak` with the layout change that breaks them, and the tests expect exactly
// those to fail, so fixing or breaking one shows up in the test results.
export interface Drill {
  key: string;
  css: string;
  xpath: string;
  /** Set on a selector written badly on purpose: which side is weak, and why. */
  weak?: { css?: string; xpath?: string };
}

export const DRILL: Drill[] = [
  { key: 'heading', css: 'h1', xpath: '//h1' },
  { key: 'nav-home', css: 'nav[aria-label="Main"] a[href="/home"]', xpath: '//nav//a[@href="/home"]' },
  { key: 'nav-orders', css: 'a[href="/orders"]', xpath: '//a[@href="/orders"]' },
  { key: 'nav-help', css: 'a[href="/help"]', xpath: '//nav/a[3]', weak: { xpath: 'the third child of nav: breaks when links move or get wrapped' } },
  { key: 'nav-account', css: '[aria-label="Account menu"]', xpath: '//a[@aria-label="Account menu"]' },
  { key: 'search-input', css: 'input[type="search"][name="q"]', xpath: '//input[@type="search"]' },
  { key: 'search-button', css: 'button[aria-label="Search orders"]', xpath: '//button[@aria-label="Search orders"]' },
  { key: 'chip-open', css: 'button[data-filter="open"]', xpath: '//button[@data-filter="open"]' },
  { key: 'chip-shipped', css: 'button[data-filter="shipped"]', xpath: '//button[@data-filter="shipped"]' },
  { key: 'chip-late', css: '.chip.chip-late', xpath: '//button[@data-filter="late"]', weak: { css: 'class names: renamed by a style change' } },
  { key: 'orders-table', css: 'table[aria-label="Orders"]', xpath: '//table[@aria-label="Orders"]' },
  { key: 'select-all', css: 'input[aria-label="Select all orders"]', xpath: '//input[@aria-label="Select all orders"]' },
  { key: 'row-1001-view', css: 'tr[data-order="1001"] a[href="/orders/1001"]', xpath: '//tr[@data-order="1001"]//a[contains(@href,"/orders/1001")]' },
  { key: 'row-1002-cancel', css: 'button[aria-label="Cancel order 1002"]', xpath: '//button[@aria-label="Cancel order 1002"]' },
  { key: 'row-1003-checkbox', css: 'tbody tr:nth-child(3) input[type="checkbox"]', xpath: '//input[@name="select-1003"]', weak: { css: 'the third row: breaks when rows are sorted another way' } },
  { key: 'order-total', css: 'main > section > .total > span', xpath: '//*[@data-testid="order-total"]', weak: { css: 'a direct-child chain through a class: breaks when a wrapper is added or classes are renamed' } },
  { key: 'full-name', css: 'input[name="fullName"]', xpath: '//input[@name="fullName"]' },
  { key: 'email', css: 'input[type="email"]', xpath: '//input[@type="email"]' },
  { key: 'phone', css: 'input[autocomplete="tel"]', xpath: '//input[@autocomplete="tel"]' },
  { key: 'country', css: 'select[name="country"]', xpath: '//select[@name="country"]' },
  { key: 'speed-standard', css: 'input[type="radio"][value="standard"]', xpath: '//input[@type="radio" and @value="standard"]' },
  { key: 'speed-express', css: 'input[type="radio"][value="express"]', xpath: '(//form/div[5]//input)[2]', weak: { xpath: 'a position in the form: breaks when fields move or get wrapped' } },
  { key: 'newsletter', css: 'input[name="newsletter"]', xpath: '//input[@name="newsletter"]' },
  { key: 'notes', css: 'textarea[name="notes"]', xpath: '//textarea[@name="notes"]' },
  { key: 'place-order', css: '[data-testid="place-order"]', xpath: '//button[@data-testid="place-order"]' },
  { key: 'reset', css: 'button[type="reset"]', xpath: '//button[@type="reset"]' },
  { key: 'dialog-close', css: 'dialog[aria-labelledby="help-title"] button[aria-label="Close"]', xpath: '//dialog//button[@aria-label="Close"]' },
  { key: 'terms', css: 'a[href="/terms"]', xpath: '//a[@href="/terms"]' },
  { key: 'privacy', css: 'a[href="/privacy"]', xpath: '//a[@href="/privacy"]' },
  { key: 'contact', css: 'a[href^="mailto:"]', xpath: '//a[starts-with(@href,"mailto:")]' },
];
