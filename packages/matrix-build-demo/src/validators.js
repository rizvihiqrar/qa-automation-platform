'use strict';

function isEmail(value) {
  if (typeof value !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPostalCode(value, locale = 'CA') {
  if (typeof value !== 'string') return false;
  const patterns = {
    CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
    US: /^\d{5}(-\d{4})?$/,
    UK: /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}$/,
  };
  const pattern = patterns[locale];
  if (!pattern) throw new Error(`Unsupported locale: ${locale}`);
  return pattern.test(value.trim());
}

function isPhoneNumber(value) {
  if (typeof value !== 'string') return false;
  return /^[+]?[\d\s\-().]{7,15}$/.test(value.trim());
}

module.exports = { isEmail, isUrl, isPostalCode, isPhoneNumber };
