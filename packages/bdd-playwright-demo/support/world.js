import { setWorldConstructor, Before, After } from '@cucumber/cucumber';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'https://www.saucedemo.com';

class PlaywrightWorld {
  async openBrowser() {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 720 } });
    this.page = await this.context.newPage();
  }

  async closeBrowser() {
    await this.context?.close();
    await this.browser?.close();
  }
}

setWorldConstructor(PlaywrightWorld);

Before(async function () {
  await this.openBrowser();
});

After(async function () {
  await this.closeBrowser();
});
