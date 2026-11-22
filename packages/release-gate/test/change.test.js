import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide } from '../src/gate.js';
import { applyChange, evaluateChange, reviewStatus, validateChange } from '../src/change.js';
import { formatMemo } from '../src/memo.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const here = (...p) => fileURLToPath(new URL(path.posix.join('..', ...p), import.meta.url));

const standard = (extra = {}) => ({ type: 'standard', requestedAt: '2026-11-20T09:00Z', plannedFor: '2026-11-20T09:30Z', ...extra });
const normal = (extra = {}) => ({ type: 'normal', requestedAt: '2026-11-20T09:00Z', plannedFor: '2026-11-21T09:00Z', approvedBy: 'Release manager', ...extra });
const emergency = (extra = {}) => ({ type: 'emergency', requestedAt: '2026-11-20T09:00Z', plannedFor: '2026-11-20T10:00Z', approvedBy: 'On-call manager', reason: 'A partner goes live today.', ...extra });
const release = (extra = {}) => ({ version: '2.0.0', date: '2026-11-22', summary: 'A test release.', changes: ['One change.'], risks: [], signOff: ['QA lead'], ...extra });

const passing = [{ name: 'smoke', kind: 'tests', passed: true, detail: '3/3 passed', counts: { passed: 3, failed: 0, flaky: 0 } }];
const failing = [{ name: 'contract', kind: 'check', passed: false, detail: '18/20 match' }];
const go = () => decide({ requiredChecks: ['smoke'] }, passing);
const noGo = () => decide({}, failing);

test('a standard change needs no approver and no wait', () => {
  const e = evaluateChange({}, standard());
  assert.deepEqual(e.problems, []);
  assert.deepEqual(e.obligations, []);
  assert.equal(e.reviewDueBy, null);
});

test('a normal change needs an approver', () => {
  const c = normal(); delete c.approvedBy;
  assert.match(evaluateChange({}, c).problems[0], /needs an approver/);
  assert.throws(() => evaluateChange({}, normal({ approvedBy: '   ' })), /change\.approvedBy must be text/);
});

test('a normal change waits 24 hours: 23 hours is blocked and exactly 24 passes', () => {
  assert.match(evaluateChange({}, normal({ plannedFor: '2026-11-21T08:00Z' })).problems[0], /waits 24 hours and this one waits 23/);
  assert.deepEqual(evaluateChange({}, normal({ plannedFor: '2026-11-21T09:00Z' })).problems, []);
});

test('the wait is counted in real time across zones, not by the clock text', () => {
  // 09:00Z is 04:00 at -05:00, so planning for 09:00-05:00 the next day is 29 hours later
  const ok = normal({ requestedAt: '2026-11-20T09:00Z', plannedFor: '2026-11-21T09:00-05:00' });
  assert.deepEqual(evaluateChange({}, ok).problems, []);
  const short = normal({ requestedAt: '2026-11-20T09:00-05:00', plannedFor: '2026-11-21T09:00Z' });
  assert.match(evaluateChange({}, short).problems[0], /waits 24 hours/);
});

test('a release planned before the change was asked for is blocked', () => {
  const e = evaluateChange({}, standard({ plannedFor: '2026-11-19T09:00Z' }));
  assert.match(e.problems.join(' '), /before the change was requested/);
});

test('an emergency change skips the wait', () => {
  const e = evaluateChange({}, emergency({ plannedFor: '2026-11-20T09:05Z' }));
  assert.deepEqual(e.problems, []);
});

test('an emergency change still needs an approver and a reason', () => {
  const noReason = emergency(); delete noReason.reason;
  assert.match(evaluateChange({}, noReason).problems[0], /needs the reason it cannot wait/);
  const noApprover = emergency(); delete noApprover.approvedBy;
  assert.match(evaluateChange({}, noApprover).problems[0], /needs an approver/);
});

test('an emergency change owes a review five days after the release, and it is written in the obligations', () => {
  const e = evaluateChange({}, emergency({ plannedFor: '2026-11-20T10:00Z' }));
  assert.equal(e.reviewDueBy, '2026-11-25');
  assert.deepEqual(e.obligations, ['A review of this change is owed by 2026-11-25.']);
  assert.deepEqual(evaluateChange({}, emergency({ reviewDoneOn: '2026-11-22' })).obligations, ['The review was done on 2026-11-22.']);
});

test('a policy can change the waiting time and the review period', () => {
  const policy = { changeTypes: { normal: { waitHours: 48 }, emergency: { reviewWithinDays: 2 } } };
  assert.match(evaluateChange(policy, normal()).problems[0], /waits 48 hours/);
  assert.equal(evaluateChange(policy, emergency()).reviewDueBy, '2026-11-22');
});

test('review status: due, late, done and none (the due day itself is not late)', () => {
  const e = evaluateChange({}, emergency());
  assert.equal(reviewStatus(e, '2026-11-25'), 'due');
  assert.equal(reviewStatus(e, '2026-11-26'), 'overdue');
  assert.equal(reviewStatus(evaluateChange({}, emergency({ reviewDoneOn: '2026-11-24' })), '2026-12-30'), 'done');
  assert.equal(reviewStatus(evaluateChange({}, normal()), '2030-01-01'), 'none');
});

test('an emergency never relaxes the checks: a failed check is still NO-GO', () => {
  const out = applyChange(noGo(), {}, emergency());
  assert.equal(out.decision, 'no-go');
  assert.deepEqual(out.checks.find((c) => c.name === 'contract').status, 'fail');
  assert.equal(out.checks.find((c) => c.name === 'change-control').status, 'pass');
});

test('a passing gate with a broken change is NO-GO, and the reason names change-control', () => {
  const out = applyChange(go(), {}, normal({ plannedFor: '2026-11-20T10:00Z' }));
  assert.equal(out.decision, 'no-go');
  assert.match(out.reasons.at(-1), /^change-control: a normal change waits 24 hours/);
  assert.equal(out.checks.at(-1).status, 'fail');
});

test('a good change on a passing gate stays GO and the input outcome is not changed', () => {
  const before = go();
  const out = applyChange(before, {}, normal());
  assert.equal(out.decision, 'go');
  assert.equal(before.checks.length, 1);
  assert.equal(out.checks.at(-1).detail, 'normal change, approved by Release manager');
});

test('the change block is checked and the message names the field', () => {
  assert.throws(() => validateChange(null), /"change" must be an object/);
  assert.throws(() => validateChange(normal({ type: 'urgent' })), /change\.type must be one of standard, normal, emergency/);
  for (const bad of ['__proto__', 'toString', 'constructor', '', undefined]) assert.throws(() => validateChange(normal({ type: bad })), /change\.type/, String(bad));
  assert.throws(() => validateChange(normal({ requestedAt: 'Nov 3' })), /change\.requestedAt must be a date and time/);
  assert.throws(() => validateChange(normal({ plannedFor: '2026-11-21' })), /change\.plannedFor must be a date and time/);
  assert.throws(() => validateChange(normal({ plannedFor: '2026-11-21T09:00' })), /change\.plannedFor/);
  assert.throws(() => validateChange(normal({ plannedFor: '2026-13-45T09:00Z' })), /change\.plannedFor/);
  // a date that does not exist is refused, not rolled over to the next month
  assert.throws(() => validateChange(normal({ plannedFor: '2026-02-31T09:00Z' })), /change\.plannedFor/);
  assert.throws(() => validateChange(normal({ plannedFor: '2026-11-21T25:00Z' })), /change\.plannedFor/);
  assert.throws(() => validateChange(normal({ plannedFor: '2026-11-21T09:60Z' })), /change\.plannedFor/);
  assert.throws(() => validateChange(normal({ plannedFor: '2026-11-21T09:00+99:99' })), /change\.plannedFor/);
  assert.throws(() => validateChange(emergency({ reviewDoneOn: '2026-02-30' })), /change\.reviewDoneOn/);
  assert.doesNotThrow(() => validateChange(normal({ plannedFor: '2026-02-28T09:00+05:30' })));
  assert.throws(() => validateChange(normal({ approvedBy: 7 })), /change\.approvedBy must be text/);
  assert.throws(() => validateChange(normal({ reviewDoneOn: 'yesterday' })), /change\.reviewDoneOn/);
});

test('a planned time before the request gives one problem, not two', () => {
  const e = evaluateChange({}, normal({ plannedFor: '2026-11-19T09:00Z' }));
  assert.equal(e.problems.length, 1);
  assert.match(e.problems[0], /before the change was requested/);
});

test('a review dated before the release is not accepted as the review', () => {
  const e = evaluateChange({}, emergency({ reviewDoneOn: '2020-01-01' }));
  assert.match(e.problems[0], /the review is dated 2020-01-01, before the release on 2026-11-20/);
  assert.deepEqual(evaluateChange({}, emergency({ reviewDoneOn: '2026-11-20' })).problems, []);
});

test('a policy override must be a real setting with the right kind of value', () => {
  const bad = (override) => () => evaluateChange({ changeTypes: { normal: override } }, normal());
  assert.throws(bad({ waitHours: '24h' }), /changeTypes\.normal\.waitHours must be a number of zero or more/);
  assert.throws(bad({ waitHours: -1 }), /waitHours must be a number/);
  assert.throws(bad({ waitHours: NaN }), /waitHours must be a number/);
  assert.throws(bad({ needsApproval: 'no' }), /needsApproval must be true or false/);
  assert.throws(bad({ waitHour: 24 }), /waitHour is not a setting/);
  assert.deepEqual(evaluateChange({ changeTypes: { normal: { waitHours: 0 } } }, normal({ plannedFor: '2026-11-20T09:00Z' })).problems, []);
});

test('a bad policy override or a bad change block becomes a failed change-control check that says why', () => {
  const badBlock = applyChange(go(), {}, { type: 'urgent' });
  assert.equal(badBlock.decision, 'no-go');
  assert.match(badBlock.checks.at(-1).detail, /change\.type must be one of/);
  assert.match(badBlock.reasons.at(-1), /^change-control: release file: change\.type/);
  assert.equal(applyChange(go(), { changeTypes: { normal: { waitHours: '24h' } } }, normal()).decision, 'no-go');
});

test('with no change block the gate is left alone, unless the policy says one is required', () => {
  const before = go();
  assert.equal(applyChange(before, {}, undefined), before);
  const required = applyChange(before, { requireChange: true }, undefined);
  assert.equal(required.decision, 'no-go');
  assert.match(required.reasons.at(-1), /this policy needs a change type/);
  assert.equal(applyChange(before, { requireChange: true }, normal()).decision, 'go');
});

test('the memo names the change type, who approved and what is owed; without a change there is no such section', () => {
  const memo = formatMemo(applyChange(go(), {}, emergency()), release());
  assert.match(memo, /## Change type\n\n\*\*Emergency change\.\*\*/);
  assert.match(memo, /- Approved by: On-call manager/);
  assert.match(memo, /- Why it cannot wait: A partner goes live today\./);
  assert.match(memo, /- A review of this change is owed by 2026-11-25\./);
  assert.doesNotMatch(formatMemo(go(), release()), /## Change type/);
});

test('the memo of a blocked change says so in the same table as the checks', () => {
  const memo = formatMemo(applyChange(go(), {}, normal({ plannedFor: '2026-11-20T10:00Z' })), release());
  assert.match(memo, /\| change-control \| Failed \| a normal change waits 24 hours/);
  assert.match(memo, /Decision: ⛔ NO-GO/);
});

// The command line: the real gate with a real release file.
function runCli(releaseFile, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'change-'));
  const file = path.join(dir, 'release.json');
  fs.writeFileSync(file, JSON.stringify(releaseFile));
  const memo = path.join(dir, 'memo.md');
  const res = spawnSync(process.execPath, [CLI, '--check', `ok=${here('examples', 'contract-1.4.1.json')}`, '--release', file, '--memo', memo, ...extra], { encoding: 'utf8' });
  return { res, memo: fs.existsSync(memo) ? fs.readFileSync(memo, 'utf8') : null };
}

test('command line: a release with a rushed normal change exits 1 and the table shows change-control', () => {
  const { res, memo } = runCli(release({ change: normal({ plannedFor: '2026-11-20T12:00Z' }) }));
  assert.equal(res.status, 1);
  assert.match(res.stdout, /\| change-control \| fail \|/);
  assert.match(memo, /Decision: ⛔ NO-GO/);
});

test('command line: a good emergency change exits 0', () => {
  const { res, memo } = runCli(release({ change: emergency() }));
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(memo, /Emergency change/);
});

test('command line: a bad change block exits 1 and the gate table itself names the field', () => {
  const { res, memo } = runCli(release({ change: { type: 'urgent' } }));
  assert.equal(res.status, 1);
  assert.match(res.stdout, /\| change-control \| fail \| release file: change\.type must be one of/);
  assert.match(memo, /Decision: ⛔ NO-GO/);
});

test('command line: a policy that requires a change type blocks a release file without one, and a run with no release file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'change-policy-'));
  const policy = path.join(dir, 'policy.json');
  fs.writeFileSync(policy, JSON.stringify({ requireChange: true }));
  const none = spawnSync(process.execPath, [CLI, '--policy', policy, '--check', `ok=${here('examples', 'contract-1.4.1.json')}`], { encoding: 'utf8' });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /\| change-control \| fail \| this policy needs a change type/);
  const withRelease = runCli(release(), ['--policy', policy]);
  assert.equal(withRelease.res.status, 1);
});

test('a release without a change block works as before', () => {
  const { res, memo } = runCli(release());
  assert.equal(res.status, 0);
  assert.doesNotMatch(res.stdout, /change-control/);
  assert.doesNotMatch(memo, /Change type/);
});
