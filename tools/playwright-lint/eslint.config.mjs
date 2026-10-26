// Lints every Playwright package for one class of bug: a Playwright call that returns
// a promise and is not awaited. An unawaited expect races the end of the test, so it
// can pass a broken page or fail a correct one ("Test ended."); that was the llm-judge-
// check H01 flake. Run from the repo root: npm run lint:playwright
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

export const PACKAGES = [
  'a11y-aoda-audit',
  'ai-test-generator',
  'bdd-playwright-demo',
  'graphql-test-suite',
  'llm-judge-check',
  'money-course',
  'multi-user-flow-patterns',
  'qa-for-ai-features',
  'qa-practice-api',
  'visual-regression-demo',
];

const COUNT_BAN = {
  selector: "CallExpression[callee.property.name='count'][arguments.length=0]",
  message: 'locator.count() does not wait. Use await expect(locator).toHaveCount(n).',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/blob-report/**',
      '**/reports/**',
      '**/coverage/**',
      // Recorded data, not tests that run: AI-written specs kept as generated, and
      // the judge cases, some weakened on purpose (H01 is an unawaited expect).
      'packages/ai-test-generator/eval/runs/**',
      'packages/llm-judge-check/cases/**',
    ],
  },
  {
    files: PACKAGES.map((p) => `packages/${p}/**/*.{js,mjs,cjs,ts,mts}`),
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { playwright },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'playwright/missing-playwright-await': 'error',
    },
  },
  {
    // Specs only. A read of locator.count() does not wait for the page, so it can return 0
    // before the list is drawn (the multi-user-flow-patterns flake). Use
    // expect(locator).toHaveCount(n), which waits. Page objects and checks in src/ may
    // count after they have waited for something themselves.
    files: PACKAGES.map((p) => `packages/${p}/**/*.spec.{js,mjs,cjs,ts,mts}`),
    rules: { 'no-restricted-syntax': ['error', COUNT_BAN] },
  },
  {
    // The check's own proof: a deliberately unawaited expect and a bare count() that must be reported.
    files: ['tools/playwright-lint/fixtures/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { playwright },
    rules: {
      'playwright/missing-playwright-await': 'error',
      'no-restricted-syntax': ['error', COUNT_BAN],
    },
  },
];
