'use strict';

const DISCOUNT_CODES = {
  SAVE10:  0.10,
  SAVE20:  0.20,
  HALFOFF: 0.50,
};

const TAX_RATE = 0.13;

class Cart {
  constructor() {
    this._items       = [];
    this._discount    = null;
  }

  add(product) {
    if (!product || product.id === undefined || product.id === null) {
      throw new Error('Invalid product: id is required');
    }
    if (typeof product.price !== 'number' || product.price < 0) {
      throw new Error('Invalid product: price must be a non-negative number');
    }
    const qty = product.quantity !== undefined ? product.quantity : 1;
    if (!Number.isInteger(qty) || qty < 1) {
      throw new Error('Invalid product: quantity must be a positive integer');
    }

    const existing = this._items.find(i => i.id === product.id);
    if (existing) {
      existing.quantity += qty;
    } else {
      this._items.push({ id: product.id, name: product.name || '', price: product.price, quantity: qty });
    }
  }

  remove(productId) {
    const idx = this._items.findIndex(i => i.id === productId);
    if (idx === -1) throw new Error(`Product ${productId} not found in cart`);
    this._items.splice(idx, 1);
  }

  updateQuantity(productId, quantity) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('Quantity must be a positive integer');
    }
    const item = this._items.find(i => i.id === productId);
    if (!item) throw new Error(`Product ${productId} not found in cart`);
    item.quantity = quantity;
  }

  applyDiscount(code) {
    if (!code || typeof code !== 'string') {
      throw new Error('Discount code must be a non-empty string');
    }
    const rate = DISCOUNT_CODES[code.toUpperCase()];
    if (rate === undefined) throw new Error(`Invalid discount code: ${code}`);
    this._discount = { code: code.toUpperCase(), rate };
  }

  removeDiscount() {
    this._discount = null;
  }

  getSubtotal() {
    return this._items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  getDiscount() {
    if (!this._discount) return 0;
    return this.getSubtotal() * this._discount.rate;
  }

  getDiscountedSubtotal() {
    return this.getSubtotal() - this.getDiscount();
  }

  getTax() {
    return this.getDiscountedSubtotal() * TAX_RATE;
  }

  getTotal() {
    return this.getDiscountedSubtotal() + this.getTax();
  }

  getItemCount() {
    return this._items.reduce((sum, item) => sum + item.quantity, 0);
  }

  isEmpty() {
    return this._items.length === 0;
  }

  getItems() {
    return this._items.map(item => ({ ...item }));
  }

  clear() {
    this._items    = [];
    this._discount = null;
  }

  getSummary() {
    return {
      items:               this.getItems(),
      itemCount:           this.getItemCount(),
      subtotal:            this.getSubtotal(),
      discount:            this.getDiscount(),
      discountCode:        this._discount ? this._discount.code : null,
      discountedSubtotal:  this.getDiscountedSubtotal(),
      tax:                 this.getTax(),
      total:               this.getTotal(),
    };
  }
}

module.exports = { Cart, DISCOUNT_CODES, TAX_RATE };
