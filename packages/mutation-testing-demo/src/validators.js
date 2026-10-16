'use strict';

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function validatePrice(price) {
  if (typeof price !== 'number') return false;
  if (!isFinite(price)) return false;
  if (price < 0) return false;
  return true;
}

function validateQuantity(qty) {
  if (!Number.isInteger(qty)) return false;
  if (qty < 1) return false;
  return true;
}

function validateDiscountCode(code, validCodes) {
  if (!code || typeof code !== 'string') return false;
  return validCodes.includes(code.toUpperCase());
}

function validateProductId(id) {
  if (id === null || id === undefined) return false;
  if (typeof id === 'string') return id.trim().length > 0;
  if (typeof id === 'number') return Number.isInteger(id) && id > 0;
  return false;
}

module.exports = { validateEmail, validatePrice, validateQuantity, validateDiscountCode, validateProductId };
