// qa-practice-api on Postgres (Day 49): CI pulls the image through retry.sh before
// Testcontainers starts it. If the two tags drift apart, Testcontainers pulls the
// other image itself, without retries, and the job can fail on a Docker Hub 502.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const ci = read('.github', 'workflows', 'ci.yml');
const launcher = read('packages', 'qa-practice-api', 'scripts', 'with-postgres.ts');

test('CI pulls the same Postgres image that with-postgres.ts starts', () => {
  const image = launcher.match(/POSTGRES_IMAGE = '([^']+)'/)?.[1];
  assert.ok(image, 'POSTGRES_IMAGE not found in with-postgres.ts');
  const pulled = [...ci.matchAll(/docker pull --quiet (postgres:\S+)/g)].map((m) => m[1]);
  assert.deepEqual(pulled, [image]);
});

test('the qa-practice-api-postgres row runs the suite on Postgres', () => {
  const row = ci.split(/\r?\n/).find((l) => l.includes('name: qa-practice-api-postgres'));
  assert.ok(row, 'no qa-practice-api-postgres row in ci.yml');
  assert.match(row, /postgres: true/);
  assert.match(row, /command: npm run test:postgres/);
});
