// Type-checks each listed package with the shared tsconfig. Packages join this
// list as they are brought under type-checking (see ROADMAP.md, Days 15-21).
import { spawnSync } from 'child_process';
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
  'defect-report-linter',
  'log-signature-grouper',
  'webhook-harness',
  'release-gate',
  'exploratory-session-tracker',
  'api-drift-checker',
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
  const res = spawnSync(process.execPath, [TSC, '-p', path.join(ROOT, 'packages', name, 'tsconfig.json')], { encoding: 'utf8' });
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
