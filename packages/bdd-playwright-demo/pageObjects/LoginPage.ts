import type { Page } from 'playwright';

export class LoginPage {
  #page: Page;

  constructor(page: Page) { this.#page = page; }

  async navigate(): Promise<void>                   { await this.#page.goto('/'); }
  async enterUsername(username: string): Promise<void> { await this.#page.fill('[data-test="username"]', username); }
  async enterPassword(password: string): Promise<void> { await this.#page.fill('[data-test="password"]', password); }
  async clickLogin(): Promise<void>                 { await this.#page.click('[data-test="login-button"]'); }
  async getErrorMessage(): Promise<string>          { return this.#page.locator('[data-test="error"]').innerText(); }
}
