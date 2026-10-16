'use strict';

const { truncate, titleCase, slugify, countWords, isPalindrome } = require('../src/stringUtils');

describe('truncate', () => {
  test('returns string unchanged when within maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('truncates with default suffix when over maxLength', () => {
    expect(truncate('Hello World', 8)).toBe('Hello...');
  });

  test('truncates with custom suffix', () => {
    expect(truncate('Hello World', 9, '…')).toBe('Hello Wo…');
  });

  test('returns string unchanged when exactly at maxLength', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  test('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });

  test('throws TypeError for non-string input', () => {
    expect(() => truncate(123, 5)).toThrow(TypeError);
  });

  test('throws RangeError for negative maxLength', () => {
    expect(() => truncate('hello', -1)).toThrow(RangeError);
  });

  test('throws RangeError for non-integer maxLength', () => {
    expect(() => truncate('hello', 5.5)).toThrow(RangeError);
  });
});

describe('titleCase', () => {
  test('capitalises first letter of each word', () => {
    expect(titleCase('hello world')).toBe('Hello World');
  });

  test('handles already-uppercase input', () => {
    expect(titleCase('HELLO WORLD')).toBe('Hello World');
  });

  test('handles single word', () => {
    expect(titleCase('javascript')).toBe('Javascript');
  });

  test('handles empty string', () => {
    expect(titleCase('')).toBe('');
  });

  test('handles mixed case', () => {
    expect(titleCase('tHe QuIcK bRoWn FoX')).toBe('The Quick Brown Fox');
  });

  test('throws TypeError for non-string input', () => {
    expect(() => titleCase(null)).toThrow(TypeError);
  });
});

describe('slugify', () => {
  test('converts spaces to hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  test('removes special characters', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  test('collapses multiple spaces', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });

  test('trims leading and trailing spaces', () => {
    expect(slugify('  hello world  ')).toBe('hello-world');
  });

  test('handles underscores as word separators', () => {
    expect(slugify('hello_world')).toBe('hello-world');
  });

  test('handles already-slug string', () => {
    expect(slugify('hello-world')).toBe('hello-world');
  });

  test('throws TypeError for non-string input', () => {
    expect(() => slugify(42)).toThrow(TypeError);
  });
});

describe('countWords', () => {
  test('counts words in a simple sentence', () => {
    expect(countWords('Hello World')).toBe(2);
  });

  test('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  test('returns 0 for whitespace-only string', () => {
    expect(countWords('   ')).toBe(0);
  });

  test('handles leading and trailing spaces', () => {
    expect(countWords('  hello world  ')).toBe(2);
  });

  test('handles multiple spaces between words', () => {
    expect(countWords('one   two   three')).toBe(3);
  });

  test('handles single word', () => {
    expect(countWords('hello')).toBe(1);
  });

  test('throws TypeError for non-string input', () => {
    expect(() => countWords(123)).toThrow(TypeError);
  });
});

describe('isPalindrome', () => {
  test('identifies a simple palindrome', () => {
    expect(isPalindrome('racecar')).toBe(true);
  });

  test('identifies a non-palindrome', () => {
    expect(isPalindrome('hello')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isPalindrome('Racecar')).toBe(true);
  });

  test('ignores non-alphanumeric characters', () => {
    expect(isPalindrome('A man, a plan, a canal: Panama')).toBe(true);
  });

  test('handles empty string (palindrome by convention)', () => {
    expect(isPalindrome('')).toBe(true);
  });

  test('handles single character', () => {
    expect(isPalindrome('a')).toBe(true);
  });

  test('handles numeric palindrome', () => {
    expect(isPalindrome('12321')).toBe(true);
  });

  test('throws TypeError for non-string input', () => {
    expect(() => isPalindrome(123)).toThrow(TypeError);
  });
});
