// Every CI job with a fixed name needs a kind in packages/ci-and-flaky-tooling/data/job-tags.json.
// The monthly cost check fails on a job with no kind, but only when it reads a snapshot, weeks after
// the job was added: dependency audit (2026-11-20) and hcm-conversion-validation-faults (2026-11-24)
// both went in untagged, found 2026-11-25. Jobs named from a matrix (${{ ... }}) are left out:
// their names come from the matrix rows, which the package jobs tag one by one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tags = JSON.parse(fs.readFileSync('packages/ci-and-flaky-tooling/data/job-tags.json', 'utf8'));
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');

export function fixedJobNames(yaml) {
  return [...yaml.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim()).filter((n) => !n.includes('${{'));
}

test('the job names are read from ci.yml', () => {
  const names = fixedJobNames(ci);
  assert.ok(names.includes('typecheck') && names.includes('hcm-conversion-validation-faults'), names.join(', '));
  assert.deepEqual(fixedJobNames('jobs:\n  a:\n    name: one\n    steps:\n      - name: a step\n  b:\n    name: ${{ matrix.x }}\n'), ['one']);
});

test('every CI job with a fixed name has a kind in job-tags.json', () => {
  assert.deepEqual(fixedJobNames(ci).filter((n) => !(n in tags)), []);
});

// The package matrix names each job after its row's `name:`, or its package when there is none.
// Those were left to be tagged by hand, and three went in untagged: banking-api-proxy (2026-11-22),
// qa-practice-api-sampling (2026-11-20), found 2026-11-26 when banking-api-postgres was added.
export function matrixJobNames(yaml) {
  return [...yaml.matchAll(/^\s+- \{ package: ([\w-]+),(?:\s*name: ([\w-]+),)?/gm)].map((m) => m[2] ?? m[1]);
}

test('the matrix job names are read from ci.yml', () => {
  const names = matrixJobNames(ci);
  assert.ok(names.includes('banking-api') && names.includes('banking-api-postgres') && names.includes('qa-practice-api-postgres'), names.join(', '));
  assert.deepEqual(matrixJobNames('          - { package: a,   browsers: false }\n          - { package: a, name: a-b, browsers: true }\n'), ['a', 'a-b']);
});

test('every package matrix job has a kind in job-tags.json', () => {
  assert.deepEqual([...new Set(matrixJobNames(ci))].filter((n) => !(n in tags)), []);
});
