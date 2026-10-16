import { setWorldConstructor, World, Before, After } from '@cucumber/cucumber';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'https://www.saucedemo.com';

// One fresh browser per scenario. Step definitions get it as `this`.
export class PlaywrightWorld extends World {
  browser?: Browser;
  context?: BrowserContext;
  #page?: Page;

  // Steps only run after the Before hook opens the browser; this fails loudly if one doesn't.
  get page(): Page {
    if (!this.#page) throw new Error('No page: the Before hook did not open a browser');
    return this.#page;
  }

  async openBrowser(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 720 } });
    this.#page = await this.context.newPage();
  }

  async closeBrowser(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}

setWorldConstructor(PlaywrightWorld);

Before(async function (this: PlaywrightWorld) {
  await this.openBrowser();
});

After(async function (this: PlaywrightWorld) {
  await this.closeBrowser();
});
