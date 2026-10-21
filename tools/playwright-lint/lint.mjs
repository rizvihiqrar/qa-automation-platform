// npm run lint:playwright (repo root) or npm run lint (here). Exits 1 on any finding.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { PACKAGES } from './eslint.config.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG = path.join(ROOT, 'tools', 'playwright-lint', 'eslint.config.mjs');

export function linter() {
  return new ESLint({ cwd: ROOT, overrideConfigFile: CONFIG });
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const eslint = linter();
  const results = await eslint.lintFiles(PACKAGES.map((p) => `packages/${p}`));
  const formatter = await eslint.loadFormatter('stylish');
  const output = await formatter.format(results);
  const errors = results.reduce((n, r) => n + r.errorCount, 0);
  if (output) console.log(output);
  console.log(`${results.length} files in ${PACKAGES.length} Playwright packages, ${errors} unawaited Playwright calls`);
  process.exitCode = errors ? 1 : 0;
}
