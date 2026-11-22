// The real thing, not fakes: a registry in Docker, the real qa-practice-api image, and the
// real smoke tests. Run with `npm run test:promotion` (Docker must be running).
//
//   green: smoke passes on the exact image, the release tag ends on that image's digest
//   red:   the container is started with a wrong admin password, so the smoke run fails,
//          and the release tag stays on the older image
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digestOf } from '../src/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'src', 'promote-cli.js');
const API = path.join(here, '..', '..', 'qa-practice-api');
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });

// The admin the test server is seeded with (packages/qa-practice-api/tests/admin.ts).
const ADMIN_EMAIL = 'admin@qa-practice.test';
const ADMIN_PASSWORD = process.env.QA_PRACTICE_ADMIN_PASSWORD || 'Admin-only-in-tests-1!';

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = /** @type {import('node:net').AddressInfo} */ (srv.address());
    srv.close(() => resolve(port));
  });
});

let registryName;
let registry;
let base;
let repo;

before(async () => {
  let pulled = false;
  for (let i = 0; i < 3 && !pulled; i++) pulled = docker('pull', '--quiet', 'registry:2').status === 0;
  assert.ok(pulled, 'could not pull registry:2');
  const port = await freePort();
  registry = `localhost:${port}`;
  base = `http://${registry}`;
  registryName = `release-gate-registry-${port}`;
  const run = docker('run', '-d', '--rm', '--name', registryName, '-p', `127.0.0.1:${port}:5000`, 'registry:2');
  assert.equal(run.status, 0, run.stderr);
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try { up = (await fetch(`${base}/v2/`)).ok; } catch { /* starting */ }
    if (!up) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(up, `the registry did not start on ${registry}`);
  repo = 'qa-practice-api';
});

after(() => {
  docker('stop', '--time', '1', registryName);
});

// An older release: the same API built with a different label, so its digest differs.
function seedRelease() {
  const ref = `${registry}/${repo}:release`;
  assert.equal(docker('build', '--quiet', '--label', 'seed=older-release', '-t', ref, API).status, 0);
  assert.equal(docker('push', '--quiet', ref).status, 0);
  docker('rmi', ref);
}

const promoteCli = (password) => spawnSync(process.execPath, [
  CLI, '--registry', registry, '--repo', repo, '--context', API,
  '--smoke', 'npx playwright test --grep @smoke --reporter=line', '--smoke-cwd', API,
  '--container-env', 'NODE_ENV=test', '--container-env', `ADMIN_EMAIL=${ADMIN_EMAIL}`, '--container-env', `ADMIN_PASSWORD=${password}`,
], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' }, timeout: 480000 });

test('a green smoke run on the exact image moves the release tag to that image', async () => {
  seedRelease();
  const older = await digestOf(base, repo, 'release');
  assert.match(older, /^sha256:/);

  const res = promoteCli(ADMIN_PASSWORD);
  assert.equal(res.status, 0, res.stdout + res.stderr);

  const staging = await digestOf(base, repo, 'staging');
  const release = await digestOf(base, repo, 'release');
  assert.equal(release, staging, 'the release tag must equal the digest that was tested');
  assert.notEqual(release, older, 'the release tag moved off the older image');
  assert.match(res.stdout, new RegExp(`Image tested: \`${staging}\``));
});

test('a red smoke run leaves the release tag on the older image', async () => {
  seedRelease();
  const older = await digestOf(base, repo, 'release');

  const res = promoteCli('not-the-admin-password');
  assert.equal(res.status, 1, res.stdout + res.stderr);

  assert.equal(await digestOf(base, repo, 'release'), older, 'the release tag must not move');
  assert.notEqual(await digestOf(base, repo, 'staging'), older, 'the new build is only staged');
  assert.match(res.stdout, /not promoted/);
});
