'use strict';

const { clamp, roundTo, isEven, sumArray, average } = require('../src/numberUtils');

describe('clamp', () => {
  test('returns value unchanged when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test('returns min when value is below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  test('returns max when value is above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  test('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  test('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test('works with negative range', () => {
    expect(clamp(-3, -10, -1)).toBe(-3);
  });

  test('throws TypeError for non-number value', () => {
    expect(() => clamp('5', 0, 10)).toThrow(TypeError);
  });

  test('throws RangeError when min > max', () => {
    expect(() => clamp(5, 10, 0)).toThrow(RangeError);
  });
});

describe('roundTo', () => {
  test('rounds to specified decimal places', () => {
    expect(roundTo(3.14159, 2)).toBe(3.14);
  });

  test('rounds to 0 decimal places (integer)', () => {
    expect(roundTo(3.6, 0)).toBe(4);
  });

  test('does not change value when already rounded', () => {
    expect(roundTo(3.14, 2)).toBe(3.14);
  });

  test('rounds up correctly', () => {
    expect(roundTo(2.675, 2)).toBeCloseTo(2.68, 1);
  });

  test('handles negative numbers', () => {
    expect(roundTo(-3.14159, 2)).toBe(-3.14);
  });

  test('throws TypeError for non-number value', () => {
    expect(() => roundTo('3.14', 2)).toThrow(TypeError);
  });

  test('throws RangeError for negative decimals', () => {
    expect(() => roundTo(3.14, -1)).toThrow(RangeError);
  });

  test('throws RangeError for non-integer decimals', () => {
    expect(() => roundTo(3.14, 1.5)).toThrow(RangeError);
  });
});

describe('isEven', () => {
  test('identifies even numbers', () => {
    expect(isEven(4)).toBe(true);
    expect(isEven(0)).toBe(true);
    expect(isEven(-2)).toBe(true);
  });

  test('identifies odd numbers', () => {
    expect(isEven(3)).toBe(false);
    expect(isEven(1)).toBe(false);
    expect(isEven(-3)).toBe(false);
  });

  test('throws TypeError for non-integer input', () => {
    expect(() => isEven(2.5)).toThrow(TypeError);
    expect(() => isEven('2')).toThrow(TypeError);
  });
});

describe('sumArray', () => {
  test('sums an array of numbers', () => {
    expect(sumArray([1, 2, 3, 4, 5])).toBe(15);
  });

  test('returns 0 for empty array', () => {
    expect(sumArray([])).toBe(0);
  });

  test('handles negative numbers', () => {
    expect(sumArray([-1, -2, 3])).toBe(0);
  });

  test('handles single element', () => {
    expect(sumArray([42])).toBe(42);
  });

  test('throws TypeError for non-array input', () => {
    expect(() => sumArray('not an array')).toThrow(TypeError);
  });

  test('throws TypeError when array contains non-numbers', () => {
    expect(() => sumArray([1, 2, 'three'])).toThrow(TypeError);
  });
});

describe('average', () => {
  test('calculates average of an array', () => {
    expect(average([1, 2, 3, 4, 5])).toBe(3);
  });

  test('handles single element', () => {
    expect(average([42])).toBe(42);
  });

  test('handles decimal results', () => {
    expect(average([1, 2])).toBe(1.5);
  });

  test('handles negative numbers', () => {
    expect(average([-10, 10])).toBe(0);
  });

  test('throws TypeError for non-array input', () => {
    expect(() => average('not an array')).toThrow(TypeError);
  });

  test('throws RangeError for empty array', () => {
    expect(() => average([])).toThrow(RangeError);
  });
});
