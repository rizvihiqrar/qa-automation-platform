// banking-api through mitmproxy (Day S9): CI pulls the proxy image through retry.sh before
// the tests start it with `docker run`. If the tag drifts apart, docker pulls the other
// image itself, without retries, and the job can fail on a registry 502. Same guard as
// collector-ci.test.mjs and postgres-ci.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const ci = read('.github', 'workflows', 'ci.yml');
const proxyImage = /PROXY_IMAGE = '([^']+)'/.exec(read('packages', 'banking-api', 'test-proxy', 'proxy.ts'))?.[1];

test('CI pulls the image that test-proxy/proxy.ts starts', () => {
  assert.ok(proxyImage, 'PROXY_IMAGE not found in test-proxy/proxy.ts');
  const pulled = [...ci.matchAll(/docker pull --quiet (\S+)/g)].map((m) => m[1]);
  assert.ok(pulled.includes(proxyImage), `ci.yml does not pull ${proxyImage}`);
});

test('the banking-api-proxy row runs the wire tests in a proxy job', () => {
  const row = ci.split(/\r?\n/).find((l) => l.includes('name: banking-api-proxy'));
  assert.ok(row, 'no banking-api-proxy row in ci.yml');
  assert.match(row, /proxy: true/);
  assert.match(row, /command: npm run test:proxy\b/);
});

test('the pull step runs for the proxy job', () => {
  assert.match(ci, /- name: Pull mitmproxy image\r?\n\s+if: matrix\.proxy\b/);
});

test('the proxy tests are not part of the plain banking-api run, which has no Docker step before it', () => {
  const pkg = JSON.parse(read('packages', 'banking-api', 'package.json'));
  assert.doesNotMatch(pkg.scripts.test, /test-proxy/);
  assert.match(pkg.scripts['test:proxy'], /test-proxy/);
  const plain = ci.split(/\r?\n/).find((l) => l.includes('package: banking-api,') && l.includes('npm test &&'));
  assert.ok(plain && !/proxy/.test(plain), 'the plain banking-api row must not run the proxy tests');
});
