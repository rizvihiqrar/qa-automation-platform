// The sites to watch: public demo sites made for testing, plus this repo's own dashboard.
// Each was reachable and showed the expected title and element on 2026-10-29. A check passes
// only if the page loads (status under 400), the title matches, and the element is visible.

export interface Site {
  name: string;
  url: string;
  /** The page's <title> must match this. */
  title: RegExp;
  /** An element that must be visible once the page has loaded. */
  selector: string;
}

export const SITES: Site[] = [
  { name: 'saucedemo', url: 'https://www.saucedemo.com/', title: /Swag Labs/, selector: '#login-button' },
  { name: 'the-internet', url: 'https://the-internet.herokuapp.com/', title: /The Internet/, selector: 'h1.heading' },
  { name: 'playwright.dev', url: 'https://playwright.dev/', title: /Playwright/, selector: 'h1' },
  { name: 'ci-dashboard', url: 'https://rizvihiqrar.github.io/qa-automation-platform/', title: /CI Dashboard/, selector: 'h1' },
];
