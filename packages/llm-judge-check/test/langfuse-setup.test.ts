// Day 42: the self-hosted Langfuse the CI job starts. The compose file is Langfuse's
// own, so these check only what was changed or relied on: pinned images, no telemetry,
// keys that match between the env file and the job, and a job that runs the check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PKG } from '../src/render.ts';

// Git may check these out with CRLF on Windows.
const read = (...p: string[]) => fs.readFileSync(path.join(PKG, ...p), 'utf8').replace(/\r\n/g, '\n');
const compose = read('langfuse', 'docker-compose.yml');
const env = Object.fromEntries(
  read('langfuse', 'local.env').split('\n')
    .filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const ci = read('..', '..', '.github', 'workflows', 'ci.yml');
const job = ci.split('\n  langfuse-traces:\n')[1]?.split(/\n {2}[a-z-]+:\n/)[0] ?? '';

test('both Langfuse images are pinned to one release', () => {
  const images = [...compose.matchAll(/image: \S+\/langfuse\/(langfuse(?:-worker)?):(\S+)/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(images.sort(), ['langfuse-worker:4.51.0', 'langfuse:4.51.0']);
  assert.match(compose, /blob\/v4\.51\.0\/docker-compose\.yml/);
});

test('every other image names a version', () => {
  for (const [, image] of compose.matchAll(/image: (\S+)/g)) {
    if (/chainguard\/minio$/.test(image!)) continue; // upstream uses Chainguard's rolling image; documented in langfuse/README.md
    assert.match(image!, /:[\w.${}:-]*\d/, `${image} has no version`);
  }
});

test('Langfuse telemetry is off unless asked for', () => {
  assert.match(compose, /TELEMETRY_ENABLED: \$\{TELEMETRY_ENABLED:-false\}/);
  assert.doesNotMatch(compose, /TELEMETRY_ENABLED:-true/);
});

test('the env file creates the project the job signs in to', () => {
  for (const k of ['ORG_ID', 'PROJECT_ID', 'PROJECT_PUBLIC_KEY', 'PROJECT_SECRET_KEY', 'USER_EMAIL', 'USER_PASSWORD']) {
    assert.ok(env[`LANGFUSE_INIT_${k}`], `LANGFUSE_INIT_${k} is not set`);
    assert.doesNotMatch(env[`LANGFUSE_INIT_${k}`]!, /^["']/, 'compose passes quotes through literally');
  }
  assert.ok(job, 'no langfuse-traces job in ci.yml');
  assert.match(job, new RegExp(`LANGFUSE_PUBLIC_KEY: ${env.LANGFUSE_INIT_PROJECT_PUBLIC_KEY}\\n`));
  assert.match(job, new RegExp(`LANGFUSE_SECRET_KEY: ${env.LANGFUSE_INIT_PROJECT_SECRET_KEY}\\n`));
});

test('the CI job starts this Langfuse, runs the check and publishes the report', () => {
  assert.match(job, /docker compose -f langfuse\/docker-compose\.yml --env-file langfuse\/local\.env up -d/);
  assert.match(job, /run: npm run traces -- --out traces-report/);
  assert.match(job, /name: report-langfuse-traces\n\s+path: packages\/llm-judge-check\/traces-report\//);
});
