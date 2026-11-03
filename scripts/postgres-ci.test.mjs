// qa-practice-api on Postgres (Day 49): CI pulls the images through retry.sh before
// Testcontainers starts them. If the tags drift apart, Testcontainers pulls the
// other image itself, without retries, and the job can fail on a registry 502.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresImages } from './burn-in.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const ci = read('.github', 'workflows', 'ci.yml');

// Every image with-postgres.ts starts (Postgres, and Toxiproxy since Day 51), read
// the same way burn-in reads them, so the two can't disagree.
const images = postgresImages();

test('CI pulls every image that with-postgres.ts starts', () => {
  assert.equal(images.length, 2, 'POSTGRES_IMAGE and TOXIPROXY_IMAGE not both found in with-postgres.ts');
  const pulled = [...ci.matchAll(/docker pull --quiet (\S+)/g)].map((m) => m[1]);
  for (const image of images) assert.ok(pulled.includes(image), `ci.yml does not pull ${image}`);
});

test('the qa-practice-api-postgres row runs the suite on Postgres', () => {
  const row = ci.split(/\r?\n/).find((l) => l.includes('name: qa-practice-api-postgres'));
  assert.ok(row, 'no qa-practice-api-postgres row in ci.yml');
  assert.match(row, /postgres: true/);
  assert.match(row, /command: npm run test:postgres/);
});
