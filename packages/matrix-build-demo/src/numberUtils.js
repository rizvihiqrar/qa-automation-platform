'use strict';

function clamp(value, min, max) {
  if (typeof value !== 'number') throw new TypeError('value must be a number');
  if (min > max) throw new RangeError('min must be <= max');
  return Math.min(Math.max(value, min), max);
}

function roundTo(value, decimals) {
  if (typeof value !== 'number') throw new TypeError('value must be a number');
  if (!Number.isInteger(decimals) || decimals < 0) throw new RangeError('decimals must be a non-negative integer');
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function isEven(n) {
  if (!Number.isInteger(n)) throw new TypeError('n must be an integer');
  return n % 2 === 0;
}

function sumArray(arr) {
  if (!Array.isArray(arr)) throw new TypeError('arr must be an array');
  return arr.reduce((total, n) => {
    if (typeof n !== 'number') throw new TypeError('all elements must be numbers');
    return total + n;
  }, 0);
}

function average(arr) {
  if (!Array.isArray(arr)) throw new TypeError('arr must be an array');
  if (arr.length === 0) throw new RangeError('arr must not be empty');
  return sumArray(arr) / arr.length;
}

module.exports = { clamp, roundTo, isEven, sumArray, average };
