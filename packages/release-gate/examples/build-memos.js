// Builds the example memos (same gate policy as the Release workflow) and the example
// readiness pages (the same policy plus the readiness checks) from the example inputs.
// `node examples/build-memos.js` rewrites examples/memos/ and examples/pages/;
// test/memo.test.js and test/readiness.test.js fail when a committed file no longer matches.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { run } from '../src/cli.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (...p) => path.join(root, ...p);

export function buildExamples() {
  const out = {};
  for (const version of ['1.4.0', '1.4.1']) {
    const { memo } = run({
      policy: read('gate.policy.json'),
      version,
      release: path.join(here, `release-${version}.json`),
      memo: 'unused',
      inputs: [
        { adapter: '--playwright', name: 'smoke-tests', file: read('test', 'fixtures', 'smoke-playwright.json') },
        { adapter: '--check', name: 'api-contract', file: path.join(here, `contract-${version}.json`) },
        { adapter: '--k6', name: 'performance', file: read('test', 'fixtures', 'k6-load.json') },
      ],
    });
    out[`${version}.md`] = memo;
  }
  return out;
}

// "today" is fixed so a page never changes with the clock.
export const PAGE_DAY = '2026-11-22';

export function buildPages() {
  const out = {};
  for (const version of ['1.4.0', '1.4.1']) {
    const { page } = run({
      policy: path.join(here, 'policy-readiness.json'),
      version,
      release: path.join(here, `release-${version}.json`),
      memo: 'unused',
      readiness: path.join(here, `readiness-${version}.json`),
      page: 'unused',
      today: PAGE_DAY,
      inputs: [
        { adapter: '--playwright', name: 'smoke-tests', file: read('test', 'fixtures', 'smoke-playwright.json') },
        { adapter: '--check', name: 'api-contract', file: path.join(here, `contract-${version}.json`) },
        { adapter: '--k6', name: 'performance', file: read('test', 'fixtures', 'k6-load.json') },
      ],
    });
    out[`${version}.html`] = page;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, text] of Object.entries(buildExamples())) fs.writeFileSync(path.join(here, 'memos', file), text);
  fs.mkdirSync(path.join(here, 'pages'), { recursive: true });
  for (const [file, text] of Object.entries(buildPages())) fs.writeFileSync(path.join(here, 'pages', file), text);
}
