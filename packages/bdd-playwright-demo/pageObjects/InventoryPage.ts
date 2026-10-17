import type { Page } from 'playwright';

// The values the sort dropdown accepts.
export type SortOption = 'az' | 'za' | 'lohi' | 'hilo';

export class InventoryPage {
  #page: Page;

  constructor(page: Page) { this.#page = page; }

  // count() doesn't wait, so wait for the first card to render before counting.
  async getItemCount(): Promise<number> {
    const items = this.#page.locator('[data-test="inventory-item"]');
    await items.first().waitFor();
    return items.count();
  }
  async addToCart(slug: string): Promise<void>      { await this.#page.click(`[data-test="add-to-cart-${slug}"]`); }
  async getCartBadge(): Promise<string>             { return this.#page.locator('[data-test="shopping-cart-badge"]').innerText(); }
  async sortBy(value: SortOption): Promise<void>    { await this.#page.selectOption('[data-test="product-sort-container"]', value); }
  async getFirstItemName(): Promise<string>         { return this.#page.locator('[data-test="inventory-item-name"]').first().innerText(); }
}
