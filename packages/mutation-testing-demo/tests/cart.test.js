'use strict';

const { Cart } = require('../src/cart');

describe('Cart — basic operations', () => {
  let cart;
  beforeEach(() => { cart = new Cart(); });

  test('new cart is empty', () => {
    expect(cart.isEmpty()).toBe(true);
    expect(cart.getItemCount()).toBe(0);
    expect(cart.getSubtotal()).toBe(0);
  });

  test('add item makes cart non-empty', () => {
    cart.add({ id: 1, name: 'Widget', price: 10.00 });
    expect(cart.isEmpty()).toBe(false);
    expect(cart.getItemCount()).toBe(1);
  });

  test('add item with explicit quantity', () => {
    cart.add({ id: 1, price: 10.00, quantity: 3 });
    expect(cart.getItemCount()).toBe(3);
  });

  test('adding the same id accumulates quantity', () => {
    cart.add({ id: 1, price: 10.00 });
    cart.add({ id: 1, price: 10.00, quantity: 2 });
    expect(cart.getItemCount()).toBe(3);
    expect(cart.getItems()).toHaveLength(1);
  });

  test('adding different ids creates separate line items', () => {
    cart.add({ id: 1, price: 5.00 });
    cart.add({ id: 2, price: 8.00 });
    expect(cart.getItems()).toHaveLength(2);
  });

  test('subtotal is sum of price × quantity across all items', () => {
    cart.add({ id: 1, price: 5.00, quantity: 2 });
    cart.add({ id: 2, price: 3.00, quantity: 4 });
    expect(cart.getSubtotal()).toBe(22.00);
  });

  test('remove deletes the item by id', () => {
    cart.add({ id: 1, price: 5.00 });
    cart.add({ id: 2, price: 10.00 });
    cart.remove(1);
    expect(cart.getItems()).toHaveLength(1);
    expect(cart.getItems()[0].id).toBe(2);
  });

  test('remove non-existent id throws', () => {
    expect(() => cart.remove(99)).toThrow('not found in cart');
  });

  test('updateQuantity changes quantity', () => {
    cart.add({ id: 1, price: 5.00 });
    cart.updateQuantity(1, 5);
    expect(cart.getItemCount()).toBe(5);
  });

  test('updateQuantity on missing id throws', () => {
    expect(() => cart.updateQuantity(99, 1)).toThrow('not found in cart');
  });

  test('clear empties items and removes discount', () => {
    cart.add({ id: 1, price: 5.00 });
    cart.applyDiscount('SAVE10');
    cart.clear();
    expect(cart.isEmpty()).toBe(true);
    expect(cart.getDiscount()).toBe(0);
    expect(cart.getSummary().discountCode).toBeNull();
  });

  test('getItems returns copies — mutations do not affect cart', () => {
    cart.add({ id: 1, price: 5.00 });
    const items = cart.getItems();
    items[0].price = 999;
    expect(cart.getSubtotal()).toBe(5.00);
  });
});

describe('Cart — add validation', () => {
  let cart;
  beforeEach(() => { cart = new Cart(); });

  test('add without id throws', () => {
    expect(() => cart.add({ price: 5.00 })).toThrow('id is required');
  });

  test('add with null id throws', () => {
    expect(() => cart.add({ id: null, price: 5.00 })).toThrow('id is required');
  });

  test('add with negative price throws', () => {
    expect(() => cart.add({ id: 1, price: -1 })).toThrow('non-negative');
  });

  test('add with non-number price throws', () => {
    expect(() => cart.add({ id: 1, price: 'free' })).toThrow('non-negative');
  });

  test('add with fractional quantity throws', () => {
    expect(() => cart.add({ id: 1, price: 5, quantity: 1.5 })).toThrow('positive integer');
  });

  test('add with zero quantity throws', () => {
    expect(() => cart.add({ id: 1, price: 5, quantity: 0 })).toThrow('positive integer');
  });

  test('updateQuantity with 0 throws', () => {
    cart.add({ id: 1, price: 5 });
    expect(() => cart.updateQuantity(1, 0)).toThrow('positive integer');
  });

  test('updateQuantity with float throws', () => {
    cart.add({ id: 1, price: 5 });
    expect(() => cart.updateQuantity(1, 1.5)).toThrow('positive integer');
  });
});

describe('Cart — discount application', () => {
  let cart;
  beforeEach(() => {
    cart = new Cart();
    cart.add({ id: 1, price: 100.00 });
  });

  test('SAVE10 gives 10% off', () => {
    cart.applyDiscount('SAVE10');
    expect(cart.getDiscount()).toBeCloseTo(10.00);
    expect(cart.getDiscountedSubtotal()).toBeCloseTo(90.00);
  });

  test('SAVE20 gives 20% off', () => {
    cart.applyDiscount('SAVE20');
    expect(cart.getDiscount()).toBeCloseTo(20.00);
  });

  test('HALFOFF gives 50% off', () => {
    cart.applyDiscount('HALFOFF');
    expect(cart.getDiscount()).toBeCloseTo(50.00);
    expect(cart.getDiscountedSubtotal()).toBeCloseTo(50.00);
  });

  test('discount codes are case insensitive', () => {
    cart.applyDiscount('save10');
    expect(cart.getDiscount()).toBeCloseTo(10.00);
  });

  test('invalid code throws', () => {
    expect(() => cart.applyDiscount('BADCODE')).toThrow('Invalid discount code');
  });

  test('empty string throws', () => {
    expect(() => cart.applyDiscount('')).toThrow();
  });

  test('null throws', () => {
    expect(() => cart.applyDiscount(null)).toThrow();
  });

  test('removeDiscount restores full subtotal', () => {
    cart.applyDiscount('SAVE10');
    cart.removeDiscount();
    expect(cart.getDiscount()).toBe(0);
    expect(cart.getDiscountedSubtotal()).toBe(100.00);
  });

  test('no discount returns 0', () => {
    expect(cart.getDiscount()).toBe(0);
  });

  test('getSummary reflects discount code name', () => {
    cart.applyDiscount('SAVE20');
    expect(cart.getSummary().discountCode).toBe('SAVE20');
  });

  test('getSummary with no discount has null discountCode', () => {
    expect(cart.getSummary().discountCode).toBeNull();
  });
});

describe('Cart — tax and total', () => {
  let cart;
  beforeEach(() => {
    cart = new Cart();
    cart.add({ id: 1, price: 100.00 });
  });

  test('tax is 13% of discounted subtotal', () => {
    expect(cart.getTax()).toBeCloseTo(13.00);
  });

  test('tax is calculated after discount', () => {
    cart.applyDiscount('SAVE10');
    expect(cart.getTax()).toBeCloseTo(11.70); // 90 × 0.13
  });

  test('total = discounted subtotal + tax', () => {
    expect(cart.getTotal()).toBeCloseTo(113.00);
  });

  test('total with SAVE20 applied', () => {
    cart.applyDiscount('SAVE20');
    expect(cart.getTotal()).toBeCloseTo(90.40); // 80 × 1.13
  });

  test('empty cart total and tax are both 0', () => {
    const empty = new Cart();
    expect(empty.getTotal()).toBe(0);
    expect(empty.getTax()).toBe(0);
  });
});

describe('Cart — getSummary', () => {
  test('all fields are present and correct', () => {
    const cart = new Cart();
    cart.add({ id: 1, name: 'Widget', price: 100 });
    cart.applyDiscount('SAVE10');
    const s = cart.getSummary();

    expect(s.items).toHaveLength(1);
    expect(s.itemCount).toBe(1);
    expect(s.subtotal).toBe(100);
    expect(s.discount).toBeCloseTo(10);
    expect(s.discountCode).toBe('SAVE10');
    expect(s.discountedSubtotal).toBeCloseTo(90);
    expect(s.tax).toBeCloseTo(11.70);
    expect(s.total).toBeCloseTo(101.70);
  });
});
