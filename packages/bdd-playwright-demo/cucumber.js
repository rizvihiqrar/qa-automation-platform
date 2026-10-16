// In an ESM config the default export *is* the default profile.
// (Wrapping it as { default: {...} } made Cucumber ignore every option, so
// support/world.ts never loaded and every step saw an undefined page.)
export default {
  paths: ['features/**/*.feature'],
  // ESM package: Cucumber loads ES modules through `import`, not `require`.
  // Node 24 strips the types from these .ts files as it imports them.
  import: ['support/world.ts', 'features/step_definitions/**/*.ts'],
  format: ['progress-bar', 'html:reports/cucumber-report.html'],
  parallel: 1,
};
