// Tests for the dependency audit gate (scripts/audit.mjs) and its allowlist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { advisories, triage } from './audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'audit-allowlist.json'), 'utf8'));

// The shape `npm audit --json` gives: each vulnerable package lists the advisories
// it has (objects) or the packages it depends on that have them (strings).
const audit = (...items) => ({
  vulnerabilities: Object.fromEntries(items.map(([name, severity, id]) => [name, {
    via: [{ name, severity, title: `${name} issue`, range: '<9', url: `https://github.com/advisories/${id}`, source: 1 }],
  }]).concat([['parent', { via: items.map(([name]) => name) }]])),
});

test('advisories are read once each, with their ID from the advisory URL', () => {
  const found = advisories(audit(['lib-a', 'high', 'GHSA-aaaa-aaaa-aaaa'], ['lib-b', 'moderate', 'GHSA-bbbb-bbbb-bbbb']));
  assert.deepEqual(found.map((a) => [a.id, a.library, a.severity]), [
    ['GHSA-aaaa-aaaa-aaaa', 'lib-a', 'high'],
    ['GHSA-bbbb-bbbb-bbbb', 'lib-b', 'moderate'],
  ]);
});

test('an untriaged high or critical fails; moderate and low do not', () => {
  const found = advisories(audit(['a', 'critical', 'GHSA-1'], ['b', 'high', 'GHSA-2'], ['c', 'moderate', 'GHSA-3'], ['d', 'low', 'GHSA-4']));
  const r = triage(found, [], 'pkg', '2026-10-18');
  assert.deepEqual(r.failures.map((a) => a.id), ['GHSA-1', 'GHSA-2']);
  assert.deepEqual(r.others.map((a) => a.id), ['GHSA-3', 'GHSA-4']);
});

test('an allowlisted advisory passes, but only for the package it names', () => {
  const found = advisories(audit(['a', 'high', 'GHSA-1']));
  const list = [{ package: 'pkg', advisory: 'GHSA-1', reason: 'why', review_by: '2027-01-01' }];
  assert.equal(triage(found, list, 'pkg', '2026-10-18').failures.length, 0);
  assert.equal(triage(found, list, 'other-pkg', '2026-10-18').failures.length, 1);
});

test('an entry that matches nothing is stale, and one past its review date is expired', () => {
  const list = [{ package: 'pkg', advisory: 'GHSA-1', reason: 'why', review_by: '2026-10-01' }];
  assert.equal(triage([], list, 'pkg', '2026-10-18').stale.length, 1);
  const r = triage(advisories(audit(['a', 'high', 'GHSA-1'])), list, 'pkg', '2026-10-18');
  assert.equal(r.expired.length, 1);
  assert.equal(r.failures.length, 0);
});

test('every allowlist entry is complete, names a real package, and has a review date', () => {
  const packages = ['.', ...fs.readdirSync(path.join(ROOT, 'packages'))];
  for (const e of allowlist) {
    assert.deepEqual(Object.keys(e), ['package', 'advisory', 'library', 'reason', 'review_by'], e.advisory);
    assert.ok(packages.includes(e.package), `${e.advisory}: no package ${e.package}`);
    assert.match(e.advisory, /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/, e.advisory);
    assert.match(e.review_by, /^\d{4}-\d{2}-\d{2}$/, e.advisory);
    assert.ok(e.reason.length > 40, `${e.advisory}: say why it can't reach anything here`);
  }
  const keys = allowlist.map((e) => `${e.package} ${e.advisory}`);
  assert.equal(new Set(keys).size, keys.length, 'duplicate entries');
});
