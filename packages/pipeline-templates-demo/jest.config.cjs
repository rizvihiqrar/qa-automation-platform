'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { lines: 85 },
  },
};
