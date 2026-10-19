import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { LoginPage } from '../../pageObjects/LoginPage.ts';
import type { PlaywrightWorld } from '../../support/world.ts';
import { SAUCEDEMO_PASSWORD } from '../../support/credentials.ts';

Given('I am on the login page', async function (this: PlaywrightWorld) {
  const login = new LoginPage(this.page);
  await login.navigate();
});

When('I enter username {string} and password {string}', async function (this: PlaywrightWorld, username: string, password: string) {
  const login = new LoginPage(this.page);
  await login.enterUsername(username);
  await login.enterPassword(password === '{saucedemo-password}' ? SAUCEDEMO_PASSWORD : password);
});

When('I click the login button', async function (this: PlaywrightWorld) {
  const login = new LoginPage(this.page);
  await login.clickLogin();
});

Then('I should be on the products page', async function (this: PlaywrightWorld) {
  await this.page.waitForURL(/inventory/, { timeout: 15000 });
  expect(this.page.url()).toContain('inventory');
});

Then('I should see an error message containing {string}', async function (this: PlaywrightWorld, expectedText: string) {
  const login = new LoginPage(this.page);
  await this.page.waitForSelector('[data-test="error"]', { timeout: 5000 });
  const errorText = await login.getErrorMessage();
  expect(errorText).toContain(expectedText);
});
