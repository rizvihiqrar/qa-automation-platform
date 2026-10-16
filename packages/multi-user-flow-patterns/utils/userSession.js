const BASE_URL = process.env.BASE_URL || 'https://www.saucedemo.com';

export async function createSession(browser, credentials) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto('/');
  await page.fill('[data-test="username"]', credentials.username);
  await page.fill('[data-test="password"]', credentials.password);
  await page.click('[data-test="login-button"]');
  await page.waitForURL(/inventory/, { timeout: 15000 });
  return { context, page };
}

export async function teardownSession({ context }) {
  await context.close();
}

export async function completeCheckout(page, info) {
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('[data-test="shopping-cart-link"]');
  await page.click('[data-test="checkout"]');
  await page.fill('[data-test="firstName"]', info.firstName);
  await page.fill('[data-test="lastName"]', info.lastName);
  await page.fill('[data-test="postalCode"]', info.zip);
  await page.click('[data-test="continue"]');
  await page.click('[data-test="finish"]');
  await page.waitForSelector('.complete-header', { timeout: 15000 });
}
