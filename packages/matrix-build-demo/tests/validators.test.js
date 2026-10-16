'use strict';

const { isEmail, isUrl, isPostalCode, isPhoneNumber } = require('../src/validators');

describe('isEmail', () => {
  test('validates a standard email address', () => {
    expect(isEmail('user@example.com')).toBe(true);
  });

  test('validates email with subdomain', () => {
    expect(isEmail('user@mail.example.com')).toBe(true);
  });

  test('validates email with plus sign', () => {
    expect(isEmail('user+tag@example.com')).toBe(true);
  });

  test('rejects email without @ symbol', () => {
    expect(isEmail('userexample.com')).toBe(false);
  });

  test('rejects email without domain', () => {
    expect(isEmail('user@')).toBe(false);
  });

  test('rejects email with spaces', () => {
    expect(isEmail('user @example.com')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isEmail('')).toBe(false);
  });

  test('returns false for non-string input', () => {
    expect(isEmail(123)).toBe(false);
    expect(isEmail(null)).toBe(false);
    expect(isEmail(undefined)).toBe(false);
  });
});

describe('isUrl', () => {
  test('validates http URL', () => {
    expect(isUrl('http://example.com')).toBe(true);
  });

  test('validates https URL', () => {
    expect(isUrl('https://example.com')).toBe(true);
  });

  test('validates URL with path and query string', () => {
    expect(isUrl('https://example.com/path?query=value')).toBe(true);
  });

  test('rejects non-http protocols', () => {
    expect(isUrl('ftp://example.com')).toBe(false);
    expect(isUrl('mailto:user@example.com')).toBe(false);
  });

  test('rejects bare domain without protocol', () => {
    expect(isUrl('example.com')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isUrl('')).toBe(false);
  });

  test('returns false for non-string input', () => {
    expect(isUrl(42)).toBe(false);
    expect(isUrl(null)).toBe(false);
  });
});

describe('isPostalCode', () => {
  describe('Canadian (CA) — default locale', () => {
    test('validates standard Canadian postal code with space', () => {
      expect(isPostalCode('M5V 2T6')).toBe(true);
    });

    test('validates Canadian postal code without space', () => {
      expect(isPostalCode('M5V2T6')).toBe(true);
    });

    test('validates Canadian postal code with hyphen', () => {
      expect(isPostalCode('M5V-2T6')).toBe(true);
    });

    test('rejects postal code with invalid format', () => {
      expect(isPostalCode('12345')).toBe(false);
    });
  });

  describe('US locale', () => {
    test('validates 5-digit US ZIP code', () => {
      expect(isPostalCode('10001', 'US')).toBe(true);
    });

    test('validates ZIP+4 code', () => {
      expect(isPostalCode('10001-1234', 'US')).toBe(true);
    });

    test('rejects non-numeric US ZIP', () => {
      expect(isPostalCode('ABCDE', 'US')).toBe(false);
    });
  });

  describe('UK locale', () => {
    test('validates UK postcode format', () => {
      expect(isPostalCode('SW1A 1AA', 'UK')).toBe(true);
    });

    test('rejects invalid UK postcode', () => {
      expect(isPostalCode('12345', 'UK')).toBe(false);
    });
  });

  test('throws for unsupported locale', () => {
    expect(() => isPostalCode('12345', 'AU')).toThrow();
  });

  test('returns false for non-string input', () => {
    expect(isPostalCode(12345)).toBe(false);
  });
});

describe('isPhoneNumber', () => {
  test('validates a 10-digit phone number', () => {
    expect(isPhoneNumber('4165551234')).toBe(true);
  });

  test('validates phone number with country code', () => {
    expect(isPhoneNumber('+1 416 555 1234')).toBe(true);
  });

  test('validates formatted phone number', () => {
    expect(isPhoneNumber('(416) 555-1234')).toBe(true);
  });

  test('rejects phone number that is too short', () => {
    expect(isPhoneNumber('123')).toBe(false);
  });

  test('rejects phone number with invalid characters', () => {
    expect(isPhoneNumber('416-abc-1234')).toBe(false);
  });

  test('returns false for non-string input', () => {
    expect(isPhoneNumber(4165551234)).toBe(false);
    expect(isPhoneNumber(null)).toBe(false);
  });
});
