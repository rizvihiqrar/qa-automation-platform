'use strict';

const {
  validateEmail,
  validatePrice,
  validateQuantity,
  validateDiscountCode,
  validateProductId,
} = require('../src/validators');

describe('validateEmail', () => {
  test.each([
    ['user@example.com',          true],
    ['first.last@domain.co.uk',   true],
    ['user+tag@example.org',      true],
  ])('valid: %s → true', (input) => {
    expect(validateEmail(input)).toBe(true);
  });

  test.each([
    ['',               false],
    [null,             false],
    [undefined,        false],
    ['notanemail',     false],
    ['@nodomain.com',  false],
    ['noat.com',       false],
    ['two@@domain.com',false],
  ])('invalid: %s → false', (input) => {
    expect(validateEmail(input)).toBe(false);
  });

  test('trims surrounding whitespace before validating', () => {
    expect(validateEmail('  user@example.com  ')).toBe(true);
  });

  test('whitespace-only string returns false', () => {
    expect(validateEmail('   ')).toBe(false);
  });
});

describe('validatePrice', () => {
  test.each([
    [0,         true],
    [9.99,      true],
    [100,       true],
    [0.001,     true],
  ])('valid: %s → true', (input) => {
    expect(validatePrice(input)).toBe(true);
  });

  test.each([
    [-1,        false],
    [-0.01,     false],
    [Infinity,  false],
    [-Infinity, false],
    [NaN,       false],
    ['10',      false],
    [null,      false],
    [undefined, false],
  ])('invalid: %s → false', (input) => {
    expect(validatePrice(input)).toBe(false);
  });
});

describe('validateQuantity', () => {
  test.each([
    [1,    true],
    [100,  true],
    [999,  true],
  ])('valid: %s → true', (input) => {
    expect(validateQuantity(input)).toBe(true);
  });

  test.each([
    [0,     false],
    [-1,    false],
    [1.5,   false],
    [NaN,   false],
    ['1',   false],
    [null,  false],
  ])('invalid: %s → false', (input) => {
    expect(validateQuantity(input)).toBe(false);
  });
});

describe('validateDiscountCode', () => {
  const codes = ['SAVE10', 'SAVE20', 'HALFOFF'];

  test('matching code returns true', () => {
    expect(validateDiscountCode('SAVE10', codes)).toBe(true);
  });

  test('matching is case insensitive', () => {
    expect(validateDiscountCode('save10', codes)).toBe(true);
    expect(validateDiscountCode('Save20', codes)).toBe(true);
  });

  test('unknown code returns false', () => {
    expect(validateDiscountCode('BADCODE', codes)).toBe(false);
  });

  test('empty string returns false', () => {
    expect(validateDiscountCode('', codes)).toBe(false);
  });

  test('null returns false', () => {
    expect(validateDiscountCode(null, codes)).toBe(false);
  });

  test('undefined returns false', () => {
    expect(validateDiscountCode(undefined, codes)).toBe(false);
  });
});

describe('validateProductId', () => {
  test.each([
    [1,         true],
    [100,       true],
    ['sku-123', true],
    ['abc',     true],
  ])('valid: %j → true', (input) => {
    expect(validateProductId(input)).toBe(true);
  });

  test.each([
    [0,         false],
    [-1,        false],
    [1.5,       false],
    ['',        false],
    ['  ',      false],
    [null,      false],
    [undefined, false],
    [[],        false],
    [{},        false],
  ])('invalid: %j → false', (input) => {
    expect(validateProductId(input)).toBe(false);
  });
});
