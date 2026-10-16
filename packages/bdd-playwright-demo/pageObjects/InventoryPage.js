export class InventoryPage {
  #page;

  constructor(page) { this.#page = page; }

  // count() doesn't wait, so wait for the first card to render before counting.
  async getItemCount() {
    const items = this.#page.locator('[data-test="inventory-item"]');
    await items.first().waitFor();
    return items.count();
  }
  async addToCart(slug)              { await this.#page.click(`[data-test="add-to-cart-${slug}"]`); }
  async getCartBadge()               { return this.#page.locator('[data-test="shopping-cart-badge"]').innerText(); }
  async isCartBadgeVisible()         { return this.#page.locator('[data-test="shopping-cart-badge"]').isVisible(); }
  async sortBy(value)                { await this.#page.selectOption('[data-test="product-sort-container"]', value); }
  async getFirstItemName()           { return this.#page.locator('[data-test="inventory-item-name"]').first().innerText(); }
  async goToCart()                   { await this.#page.click('[data-test="shopping-cart-link"]'); }
}
