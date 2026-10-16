// In an ESM config the default export *is* the default profile.
// (Wrapping it as { default: {...} } made Cucumber ignore every option, so
// support/world.js never loaded and every step saw an undefined page.)
export default {
  paths: ['features/**/*.feature'],
  // ESM package: Cucumber loads ES modules through `import`, not `require`.
  import: ['support/world.js', 'features/step_definitions/**/*.js'],
  format: ['progress-bar', 'html:reports/cucumber-report.html'],
  parallel: 1,
};
