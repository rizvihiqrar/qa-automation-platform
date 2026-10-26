// Type-checks every package that has code (postman-api-collection is a Postman
// collection with no JavaScript). TypeScript packages use tsconfig.ts.json; the rest
// are JavaScript checked with checkJs through tsconfig.base.json.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const PACKAGES = [
  'test-data-factory',
  'flaky-test-analyzer',
  'worker-scaling-benchmark',
  'ai-test-generator',
  'qa-for-ai-features',
  'qa-practice-api',
  'multi-user-flow-patterns',
  'bdd-playwright-demo',
  'sql-data-integrity',
  'defect-report-linter',
  'log-signature-grouper',
  'webhook-harness',
  'release-gate',
  'exploratory-session-tracker',
  'api-drift-checker',
  'a11y-aoda-audit',
  'k6-performance',
  'ci-dashboard',
  'llm-judge-check',
  'banking-api',
  'money-course',
  'visual-regression-demo',
  // CI demos: plain JavaScript checked with checkJs (they exist to show CI patterns)
  'contract-testing-demo',
  'mutation-testing-demo',
  'pipeline-templates-demo',
  'matrix-build-demo',
  'graphql-test-suite',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

// --install: run `npm ci` in each package first, so its own dependencies' types
// (for example @faker-js/faker) are available. CI needs this; locally they're
// usually installed already.
if (process.argv.includes('--install')) {
  for (const name of PACKAGES) {
    const dir = path.join(ROOT, 'packages', name);
    const res = spawnSync('npm ci --no-audit --no-fund', { cwd: dir, shell: true, encoding: 'utf8' });
    if (res.status !== 0) {
      console.error(`npm ci failed in ${name}:\n${res.stderr}`);
      process.exit(1);
    }
  }
}

let failed = 0;
for (const name of PACKAGES) {
  // tsconfig.typecheck.json, where present, is used instead of tsconfig.json: Stryker (in
  // mutation-testing-demo) tries to rewrite any tsconfig.json it finds and fails on TypeScript 7.
  const dir = path.join(ROOT, 'packages', name);
  const config = ['tsconfig.typecheck.json', 'tsconfig.json'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!config) { failed += 1; console.log(`FAIL  ${name} (no tsconfig)`); continue; }
  // Cypress specs run in the browser with Mocha's globals, so they have a config of
  // their own (cypress/tsconfig.json), checked as part of the same package.
  const configs = [config, path.join(dir, 'cypress', 'tsconfig.json')].filter((f) => fs.existsSync(f));
  const runs = configs.map((c) => spawnSync(process.execPath, [TSC, '-p', c], { encoding: 'utf8' }));
  const res = { status: runs.every((r) => r.status === 0) ? 0 : 1, stdout: runs.map((r) => r.stdout).join('\n') };
  const errors = (res.stdout.match(/error TS\d+/g) ?? []).length;
  if (res.status === 0) {
    console.log(`pass  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name} (${errors} error(s))`);
    console.log(res.stdout.trim().split('\n').map((l) => `      ${l}`).join('\n'));
  }
}
console.log(`\n${PACKAGES.length - failed}/${PACKAGES.length} packages type-check cleanly`);
process.exitCode = failed ? 1 : 0;
