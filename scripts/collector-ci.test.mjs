// qa-practice-api through an OpenTelemetry Collector (Day S3): CI pulls the images
// through retry.sh before Testcontainers starts them. If the tags drift apart,
// Testcontainers pulls the other image itself, without retries, and the job can fail
// on a registry 502. Same guard as postgres-ci.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectorImages } from './burn-in.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const ci = read('.github', 'workflows', 'ci.yml');

test('CI pulls every image that with-collector.ts starts', () => {
  const images = collectorImages();
  assert.equal(images.length, 2, 'COLLECTOR_IMAGE and JAEGER_IMAGE not both found in with-collector.ts');
  const pulled = [...ci.matchAll(/docker pull --quiet (\S+)/g)].map((m) => m[1]);
  for (const image of images) assert.ok(pulled.includes(image), `ci.yml does not pull ${image}`);
});

test('the qa-practice-api-collector row runs the Collector tests', () => {
  const row = ci.split(/\r?\n/).find((l) => l.includes('name: qa-practice-api-collector'));
  assert.ok(row, 'no qa-practice-api-collector row in ci.yml');
  assert.match(row, /collector: true/);
  assert.match(row, /command: npm run test:collector/);
});

test('the pull step runs for the Collector job', () => {
  assert.match(ci, /- name: Pull Collector and Jaeger images\r?\n\s+if: matrix\.collector\b/);
});

test('the Collector config keeps its scrubbing in the traces and the logs pipeline', () => {
  const config = read('packages', 'qa-practice-api', 'collector', 'config.yaml');
  const pipelines = config.split(/^  pipelines:/m)[1];
  for (const name of ['traces', 'logs']) {
    const body = pipelines.split(new RegExp(`^    ${name}:`, 'm'))[1].split(/^    \w+:/m)[0];
    assert.match(body, /processors: \[[^\]]*attributes\/scrub[^\]]*redaction/, `${name} pipeline lost its scrub or redaction step`);
  }
});
