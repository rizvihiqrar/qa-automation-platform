export class LoginPage {
  #page;

  constructor(page) { this.#page = page; }

  async navigate()                   { await this.#page.goto('/'); }
  async enterUsername(username)      { await this.#page.fill('[data-test="username"]', username); }
  async enterPassword(password)      { await this.#page.fill('[data-test="password"]', password); }
  async clickLogin()                 { await this.#page.click('[data-test="login-button"]'); }
  async getErrorMessage()            { return this.#page.locator('[data-test="error"]').innerText(); }
  async isOnInventoryPage()          { return this.#page.url().includes('inventory'); }
  async isErrorVisible()             { return this.#page.locator('[data-test="error"]').isVisible(); }
}
