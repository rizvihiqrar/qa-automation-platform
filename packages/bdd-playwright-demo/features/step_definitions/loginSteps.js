import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { LoginPage } from '../../pageObjects/LoginPage.js';

Given('I am on the login page', async function () {
  const login = new LoginPage(this.page);
  await login.navigate();
});

When('I enter username {string} and password {string}', async function (username, password) {
  const login = new LoginPage(this.page);
  await login.enterUsername(username);
  await login.enterPassword(password);
});

When('I click the login button', async function () {
  const login = new LoginPage(this.page);
  await login.clickLogin();
});

Then('I should be on the products page', async function () {
  await this.page.waitForURL(/inventory/, { timeout: 15000 });
  expect(this.page.url()).toContain('inventory');
});

Then('I should see an error message containing {string}', async function (expectedText) {
  const login = new LoginPage(this.page);
  await this.page.waitForSelector('[data-test="error"]', { timeout: 5000 });
  const errorText = await login.getErrorMessage();
  expect(errorText).toContain(expectedText);
});
