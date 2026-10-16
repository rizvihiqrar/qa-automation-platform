'use strict';

function truncate(str, maxLength, suffix = '...') {
  if (typeof str !== 'string') throw new TypeError('str must be a string');
  if (!Number.isInteger(maxLength) || maxLength < 0) throw new RangeError('maxLength must be a non-negative integer');
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - suffix.length) + suffix;
}

function titleCase(str) {
  if (typeof str !== 'string') throw new TypeError('str must be a string');
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function slugify(str) {
  if (typeof str !== 'string') throw new TypeError('str must be a string');
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function countWords(str) {
  if (typeof str !== 'string') throw new TypeError('str must be a string');
  const trimmed = str.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function isPalindrome(str) {
  if (typeof str !== 'string') throw new TypeError('str must be a string');
  const clean = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean === clean.split('').reverse().join('');
}

module.exports = { truncate, titleCase, slugify, countWords, isPalindrome };
