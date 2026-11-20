// Tests for the dependency audit gate (scripts/audit.mjs) and its allowlist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { advisories, triage, auditDir, failCount, auditSafely, auditTargets, touchesDependencies, failureReport } from './audit.mjs';

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

test('a stale entry only warns, but an expired entry or an untriaged high advisory fails', () => {
  const list = [{ package: 'pkg', advisory: 'GHSA-1', reason: 'why', review_by: '2026-12-01' }];
  // The advisory was withdrawn: the entry is stale, and the build stays green
  const stale = triage([], list, 'pkg', '2026-10-18');
  assert.equal(stale.stale.length, 1);
  assert.equal(failCount(stale), 0);
  // Past its review date still fails, so a kept entry cannot be forgotten
  const expired = triage(advisories(audit(['a', 'high', 'GHSA-1'])), list, 'pkg', '2026-12-02');
  assert.equal(failCount(expired), 1);
  // A stale entry past its review date fails too, so it cannot sit in the file for ever
  assert.equal(failCount(triage([], list, 'pkg', '2026-12-02')), 1);
  // A new high advisory with no entry fails
  assert.equal(failCount(triage(advisories(audit(['a', 'high', 'GHSA-9'])), [], 'pkg', '2026-10-18')), 1);
});

test('every allowlist entry is complete, names a real package, and has a review date', () => {
  const packages = ['.', ...fs.readdirSync(path.join(ROOT, 'packages')), ...fs.readdirSync(path.join(ROOT, 'tools')).map((t) => `tools/${t}`)];
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

test('an audit name maps to the root, a tool folder or a package folder, and each has a lockfile', () => {
  assert.equal(auditDir('.'), ROOT);
  assert.equal(auditDir('tools/playwright-lint'), path.join(ROOT, 'tools', 'playwright-lint'));
  assert.equal(auditDir('banking-api'), path.join(ROOT, 'packages', 'banking-api'));
  for (const e of allowlist.filter((x) => x.package.startsWith('tools/'))) {
    assert.ok(fs.existsSync(path.join(auditDir(e.package), 'package-lock.json')), e.package);
  }
});

// A raw `npm audit` in CI fails on every new advisory with no way to triage one that has no
// fix yet (picomatch, 2026-11-17: eight jobs red at once). Every JavaScript audit goes through
// the allowlist script instead.
const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');

// The jobs of ci.yml by name, each with its own text (a job starts at two spaces of indent).
function jobsOf(text) {
  const body = text.slice(text.indexOf('\njobs:\n') + 1);
  const parts = body.split(/^  ([\w-]+):\n/m);
  const jobs = {};
  for (let i = 1; i < parts.length; i += 2) jobs[parts[i]] = parts[i + 1];
  return jobs;
}

test('no CI job runs a raw npm audit: they all go through scripts/audit.mjs', () => {
  // Any line that is not a comment, so a matrix `command:` or a multi-line `run: |` block counts too
  const raw = ci.split('\n').filter((l) => /^[^#]*\bnpm audit\b/.test(l));
  assert.deepEqual(raw, []);
});

// One job reads the advisory feed for every package. An audit step inside a test job again
// would turn that job red whenever an advisory appears outside the repo (2026-11-17, 2026-11-18).
test('only the dependency-audit job runs scripts/audit.mjs, once, for every package', () => {
  const jobs = jobsOf(ci);
  assert.ok(jobs['dependency-audit'], 'ci.yml has a dependency-audit job');
  const users = Object.entries(jobs).filter(([, text]) => /^[^#\n]*scripts\/audit\.mjs/m.test(text)).map(([name]) => name);
  assert.deepEqual(users, ['dependency-audit']);
  const calls = jobs['dependency-audit'].split('\n').filter((l) => /^\s*run: .*audit\.mjs --all/.test(l));
  assert.equal(calls.length, 1, 'one run of --all covers the root, the lint tool and every package');
});

test('the audit job runs on main and nightly, on a pull request only for dependency changes, and blocks', () => {
  const job = jobsOf(ci)['dependency-audit'];
  // The pull request filter is the script's own file list check, and the audit step waits for it
  // The diff goes to a file first (never into a pipe): a failed git diff must fail the step, not
  // give an empty list and "needed=false", which would let a lockfile change through unaudited
  assert.match(job, /git diff --name-only "origin\/\$BASE\.\.\.HEAD" > changed-files\.txt\n\s+node scripts\/audit\.mjs --needed < changed-files\.txt/);
  assert.doesNotMatch(job, /git diff[^\n]*\|/);
  assert.match(job, /id: audit\n\s+if: steps\.scope\.outputs\.needed == 'true'/);
  // A failure still fails the job (the audit step itself only records its outcome)
  assert.match(job, /name: Dependency audit found untriaged advisories\n\s+if: steps\.audit\.outcome == 'failure'\n\s+run: exit 1/);
  // The finding goes to the ci-health issue, except on a pull request, and the job may write issues
  assert.match(job, /if: steps\.audit\.outcome == 'failure' && github\.event_name != 'pull_request'/);
  assert.match(job, /--label ci-health/);
  assert.match(job, /issues: write/);
});

// The dashboard calls a job red only for its dependency audit step time-dependent, not flaky, by the
// failed step's name (packages/ci-dashboard/src/metrics.js). The step that fails this job must match.
test('the step that fails the audit job is named so the dashboard does not count it as flaky', () => {
  const job = jobsOf(ci)['dependency-audit'];
  const failing = job.match(/- name: (.*)\n\s+if: steps\.audit\.outcome == 'failure'\n\s+run: exit 1/)?.[1];
  assert.match(failing ?? '', /dependency audit/i);
});

test('the lint job and the root script job no longer audit', () => {
  const jobs = jobsOf(ci);
  for (const name of ['typecheck', 'playwright-lint', 'test']) assert.doesNotMatch(jobs[name], /Dependency audit/, name);
});

test('--all covers the root, the lint tool and every package that has a lockfile', () => {
  const expected = ['.', 'tools/playwright-lint', ...fs.readdirSync(path.join(ROOT, 'packages'))
    .filter((p) => fs.existsSync(path.join(ROOT, 'packages', p, 'package-lock.json')))];
  assert.deepEqual([...auditTargets()].sort(), expected.sort());
  assert.ok(auditTargets().length > 30);
});

test('auditTargets skips a folder with no lockfile and lists tools by their path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-targets-'));
  for (const [dir, lock] of [['packages/with-lock', true], ['packages/no-lock', false], ['tools/lint', true]]) {
    fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    if (lock) fs.writeFileSync(path.join(tmp, dir, 'package-lock.json'), '{}');
  }
  assert.deepEqual(auditTargets(tmp), ['.', 'tools/lint', 'with-lock']);
});

test('a pull request needs the audit only for a lockfile, a package.json, the audit or the CI file', () => {
  assert.equal(touchesDependencies(['README.md', 'packages/banking-api/tests/a.test.ts']), false);
  assert.equal(touchesDependencies([]), false);
  assert.equal(touchesDependencies(['packages/banking-api/package-lock.json']), true);
  assert.equal(touchesDependencies(['package.json']), true);
  assert.equal(touchesDependencies(['tools/playwright-lint/package.json']), true);
  assert.equal(touchesDependencies(['scripts/audit-allowlist.json']), true);
  assert.equal(touchesDependencies(['scripts/audit.mjs']), true);
  assert.equal(touchesDependencies(['.github/workflows/ci.yml']), true);
  // Names that only look similar do not count
  assert.equal(touchesDependencies(['docs/package.json.md', 'packages/x/my-package.json']), false);
});

test('the failure report names only the folders that failed, with what failed', () => {
  const report = failureReport([
    { pkg: 'good', failed: false, text: 'good: ok' },
    { pkg: 'bad-one', failed: true, text: 'HIGH OR CRITICAL, not triaged:\n  high lib <9 GHSA-1 issue' },
  ], '2026-11-20');
  assert.match(report, /1 of 2 folders/);
  assert.match(report, /### bad-one/);
  assert.match(report, /GHSA-1/);
  assert.doesNotMatch(report, /good/);
});

// One folder that cannot be audited must not stop the others or hide the report (code review, 2026-11-20)
test('a folder that cannot be audited fails on its own, with the reason, and the report names it', () => {
  const res = auditSafely('no-such-package', [], '2026-11-20');
  assert.equal(res.failed, true);
  assert.match(res.text, /no-such-package: could not be audited: no package-lock\.json/);
  assert.match(failureReport([res], '2026-11-20'), /### no-such-package/);
});

test('--all with --out and no file name stops with a usage message before auditing anything', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'audit.mjs'), '--all', '--out'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage: node scripts\/audit\.mjs --all/);
});

test('--needed reads the changed files on stdin and prints a step output line', () => {
  const run = (input) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'audit.mjs'), '--needed'], { input, encoding: 'utf8' }).stdout.trim();
  assert.equal(run('README.md\n'), 'needed=false');
  assert.equal(run('README.md\r\npackages/x/package-lock.json\r\n'), 'needed=true');
});
