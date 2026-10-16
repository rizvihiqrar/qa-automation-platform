/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager:   'npm',
  reporters:        ['html', 'clear-text', 'progress'],
  testRunner:       'jest',
  coverageAnalysis: 'perTest',
  mutate:           ['src/**/*.js'],
  thresholds: {
    high:  80,
    low:   60,
    break: null,
  },
  timeoutMS:     30000,
  timeoutFactor: 1.5,
  jest: {
    enableFindRelatedTests: true,
  },
};
