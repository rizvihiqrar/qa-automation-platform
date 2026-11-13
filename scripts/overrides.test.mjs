// Newman pins libraries with known issues, so the packages that run it (postman-api-collection and
// food-truck-postman) override them in package.json with the fixed releases. A fix only counts
// when it is applied everywhere: on 2026-11-11 new node-forge advisories needed 1.4.3, and the
// Dependabot security update failed (security_update_not_possible) because the override pinned
// 1.4.2 in both packages. This reads every package that has overrides and checks two things: a
// library overridden in more than one package has the same version in each, and every copy of it
// in the lockfile, nested ones too, is exactly the version the override names. A bump made in one
// place, or never installed, fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = path.join(ROOT, 'packages');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts), 'utf8'));

// Every package with an overrides block: { name, overrides }.
const withOverrides = fs.readdirSync(PACKAGES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(PACKAGES, e.name, 'package.json')))
  .map((e) => ({ name: e.name, overrides: readJson(PACKAGES, e.name, 'package.json').overrides ?? {} }))
  .filter((p) => Object.keys(p.overrides).length > 0);

// An override that names one release ("1.4.3"), not a range, a nested object or a reference to another dependency.
const isExact = (value) => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);

// The version of every copy of a dependency in a lockfile, nested copies included.
function lockedVersions(lock, dep) {
  return Object.entries(lock.packages ?? {})
    .filter(([key]) => key === `node_modules/${dep}` || key.endsWith(`/node_modules/${dep}`))
    .map(([key, entry]) => ({ key, version: entry.version }));
}

test('there are packages with overrides to check', () => {
  assert.ok(withOverrides.length >= 2, 'postman-api-collection and food-truck-postman both override libraries');
});

test('a library overridden in more than one package has the same version in each', () => {
  const seen = new Map(); // dep -> { name, version } of the first package that overrides it
  for (const { name, overrides } of withOverrides) {
    for (const [dep, version] of Object.entries(overrides)) {
      const first = seen.get(dep);
      if (first) assert.equal(version, first.version, `${dep} is ${first.version} in ${first.name} and ${version} in ${name}`);
      else seen.set(dep, { name, version });
    }
  }
});

test('every copy of an overridden library in the lockfile is the version the override names (the break: bump package.json, skip npm install)', () => {
  for (const { name, overrides } of withOverrides) {
    const lock = readJson(PACKAGES, name, 'package-lock.json');
    for (const [dep, wanted] of Object.entries(overrides).filter(([, v]) => isExact(v))) {
      for (const copy of lockedVersions(lock, dep)) {
        assert.equal(copy.version, wanted, `${name}: ${copy.key} is ${copy.version} in package-lock.json, the override says ${wanted}. Run: npm install --package-lock-only`);
      }
    }
  }
});

test('lockedVersions finds the top-level copy and nested copies, and nothing for a package that is not there', () => {
  const lock = { packages: { '': {}, 'node_modules/qs': { version: '6.16.1' }, 'node_modules/a/node_modules/qs': { version: '6.9.0' }, 'node_modules/qsx': { version: '1.0.0' } } };
  assert.deepEqual(lockedVersions(lock, 'qs'), [{ key: 'node_modules/qs', version: '6.16.1' }, { key: 'node_modules/a/node_modules/qs', version: '6.9.0' }]);
  assert.deepEqual(lockedVersions(lock, 'lodash'), []);
  assert.deepEqual(lockedVersions({}, 'qs'), []);
});

test('only an exact release is compared; a range or an object is left alone', () => {
  assert.equal(isExact('1.4.3'), true);
  for (const value of ['^1.4.3', '~1.4', '$qs', { '.': '1.0.0' }, undefined]) assert.equal(isExact(value), false);
});

// promptfoo pins @hono/node-server to one release and asks get-uri for basic-ftp 5, so Dependabot's
// security updates for both failed on 2026-11-13 (security_update_not_possible, ci-health issue 165).
// llm-judge-check overrides them with the fixed releases; the lockfile test above keeps them applied.
test('llm-judge-check overrides the two libraries promptfoo pins to vulnerable releases', () => {
  const pkg = withOverrides.find((p) => p.name === 'llm-judge-check');
  assert.ok(pkg, 'llm-judge-check lost its overrides block: Dependabot security updates for basic-ftp and @hono/node-server will fail again');
  // First releases with the advisories fixed (hono 2.1.6, basic-ftp 6.2.4): an exact but older pin would pass the lockfile test and bring the failure back.
  const fixedFrom = { '@hono/node-server': [2, 1, 6], 'basic-ftp': [6, 2, 4] };
  const atLeast = (version, min) => { const v = version.split('.').map(Number); for (let i = 0; i < 3; i += 1) if (v[i] !== min[i]) return v[i] > min[i]; return true; };
  for (const [dep, min] of Object.entries(fixedFrom)) {
    assert.ok(isExact(pkg.overrides[dep]), `llm-judge-check must override ${dep} with an exact release`);
    assert.ok(atLeast(pkg.overrides[dep], min), `${dep} ${pkg.overrides[dep]} still has the advisory: use ${min.join('.')} or newer`);
  }
});
