// Builds the two example memos from the example inputs and the same gate policy
// the Release workflow uses. `node examples/build-memos.js` rewrites examples/memos/;
// test/memo.test.js fails when a committed memo no longer matches what this builds.
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, text] of Object.entries(buildExamples())) fs.writeFileSync(path.join(here, 'memos', file), text);
}
