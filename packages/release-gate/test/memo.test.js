import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide } from '../src/gate.js';
import { formatMemo, validateRelease } from '../src/memo.js';
import { parseArgs } from '../src/cli.js';
import { buildExamples } from '../examples/build-memos.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const here = (...p) => fileURLToPath(new URL(path.posix.join('..', ...p), import.meta.url));
const release = (extra = {}) => ({
  version: '2.0.0', date: '2026-11-22', summary: 'A test release.', changes: ['One change.'], risks: [], signOff: ['QA lead'], ...extra,
});
const passing = [{ name: 'smoke', kind: 'tests', passed: true, detail: '3/3 passed', counts: { passed: 3, failed: 0, flaky: 0 } }];
const failing = [{ name: 'contract', kind: 'check', passed: false, detail: '18/20 match' }];
const go = () => decide({ requiredChecks: ['smoke'] }, passing);
const noGo = () => decide({}, failing);

test('a GO memo says GO and a NO-GO memo says why, using the gate reasons', () => {
  assert.match(formatMemo(go(), release()), /Decision: ✅ GO/);
  const memo = formatMemo(noGo(), release());
  assert.match(memo, /Decision: ⛔ NO-GO/);
  assert.match(memo, /## Why it is not ready\n\n- contract: 18\/20 match/);
  assert.doesNotMatch(formatMemo(go(), release()), /Why it is not ready/);
});

test('the decision always comes from the gate, never from the release file', () => {
  assert.throws(() => formatMemo(noGo(), release({ decision: 'go' })), /"decision" is not allowed/);
  assert.match(formatMemo(noGo(), release({ summary: 'This is a GO.' })), /Decision: ⛔ NO-GO/);
});

test('every required field is checked and the message names it', () => {
  for (const key of ['version', 'date', 'summary', 'changes', 'risks', 'signOff']) {
    const r = release(); delete r[key];
    assert.throws(() => validateRelease(r), new RegExp(`"${key}"`), key);
  }
  assert.throws(() => validateRelease(release({ changes: [] })), /at least one change/);
  assert.throws(() => validateRelease(release({ signOff: [] })), /at least one role/);
  assert.throws(() => validateRelease(release({ changes: ['ok', ''] })), /"changes"/);
  assert.throws(() => validateRelease(release({ readyWhen: 'soon' })), /"readyWhen"/);
  assert.throws(() => validateRelease(null), /must be a JSON object/);
});

test('no risks is written as a sentence, not left as an empty heading', () => {
  assert.match(formatMemo(go(), release({ risks: [] })), /## Known risks\n\n- None known at the time of the decision\./);
});

test('a check that did not run is shown in plain words', () => {
  const memo = formatMemo(decide({ requiredChecks: ['smoke', 'contract'] }, passing), release());
  assert.match(memo, /\| contract \| Did not run \| no result \|/);
});

test('the sign-off block follows the decision', () => {
  assert.match(formatMemo(go(), release()), /confirms the release can go out/);
  assert.match(formatMemo(noGo(), release()), /confirms the release must wait/);
  assert.match(formatMemo(go(), release({ signOff: ['QA lead', 'Support lead'] })), /\| Support lead \| \| \|/);
});

test('readyWhen only shows on a NO-GO and madeReady only on a GO', () => {
  const extra = { readyWhen: ['Fix the contract.'], madeReady: 'It was fixed.' };
  assert.match(formatMemo(noGo(), release(extra)), /## What has to happen first\n\n- Fix the contract\./);
  assert.doesNotMatch(formatMemo(noGo(), release(extra)), /What made it ready/);
  assert.match(formatMemo(go(), release(extra)), /## What made it ready\n\nIt was fixed\./);
  assert.doesNotMatch(formatMemo(go(), release(extra)), /What has to happen first/);
});

test('the committed example memos match what the code builds from the example inputs', () => {
  for (const [file, text] of Object.entries(buildExamples())) {
    assert.equal(fs.readFileSync(here('examples', 'memos', file), 'utf8').replace(/\r\n/g, '\n'), text, `${file} is out of date: run node examples/build-memos.js`);
  }
});

test('the example pair is a NO-GO release followed by the GO that fixed it', () => {
  const memos = buildExamples();
  assert.match(memos['1.4.0.md'], /NO-GO/);
  assert.match(memos['1.4.0.md'], /18\/20 responses match the spec/);
  assert.match(memos['1.4.1.md'], /Decision: ✅ GO/);
  assert.match(memos['1.4.1.md'], /What made it ready/);
});

test('parseArgs wants --release and --memo together', () => {
  const base = ['--check', 'a=b.json'];
  assert.throws(() => parseArgs([...base, '--release', 'r.json']), /go together/);
  assert.throws(() => parseArgs([...base, '--memo', 'm.md']), /go together/);
  const opts = parseArgs([...base, '--release', 'r.json', '--memo', 'm.md']);
  assert.equal(opts.release, 'r.json');
  assert.equal(opts.memo, 'm.md');
});

test('the command writes the memo file and still exits 1 on NO-GO', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-'));
  const out = path.join(dir, 'memo.md');
  const res = spawnSync(process.execPath, [CLI, '--policy', here('gate.policy.json'), '--version', '1.4.0',
    '--playwright', `smoke-tests=${here('test', 'fixtures', 'smoke-playwright.json')}`,
    '--check', `api-contract=${here('examples', 'contract-1.4.0.json')}`,
    '--k6', `performance=${here('test', 'fixtures', 'k6-load.json')}`,
    '--release', here('examples', 'release-1.4.0.json'), '--memo', out],
  { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  assert.equal(res.status, 1, res.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /Release memo: 1\.4\.0/);
});

test('a bad release file stops the command with exit 2 and a message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-'));
  const bad = path.join(dir, 'r.json');
  fs.writeFileSync(bad, JSON.stringify({ version: '1' }));
  const res = spawnSync(process.execPath, [CLI, '--check', `a=${here('examples', 'contract-1.4.1.json')}`, '--release', bad, '--memo', path.join(dir, 'm.md')], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /"date"/);
});

test('a release file that is not an object is refused with a message that says so', () => {
  for (const bad of [5, 'x', null, [], undefined]) assert.throws(() => validateRelease(bad), /must be a JSON object/, String(bad));
});

test('a pipe or a line break in a check detail cannot split the table row', () => {
  const outcome = decide({}, [{ name: 'perf', kind: 'check', passed: true, detail: 'p95 < 500ms | got 400\nsecond line' }]);
  const row = formatMemo(outcome, release()).split('\n').find((l) => l.startsWith('| perf'));
  assert.equal(row, '| perf | Passed | p95 < 500ms \\| got 400 second line |');
});

test('--release and --memo need a value, not the next flag', () => {
  assert.throws(() => parseArgs(['--check', 'a=b.json', '--release', '--memo', 'm.md']), /--release needs a file path/);
  assert.throws(() => parseArgs(['--check', 'a=b.json', '--memo']), /--memo needs a file path/);
});

test('a bad release file still prints the gate table and the summary, then exits 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-'));
  const bad = path.join(dir, 'r.json');
  const summary = path.join(dir, 'summary.md');
  fs.writeFileSync(bad, JSON.stringify({ version: '1' }));
  const res = spawnSync(process.execPath, [CLI, '--check', `contract=${here('examples', 'contract-1.4.0.json')}`, '--version', '1.4.0', '--release', bad, '--memo', path.join(dir, 'm.md')],
    { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
  assert.equal(res.status, 2);
  assert.match(res.stdout, /Release gate for 1\.4\.0: ⛔ NO-GO/);
  assert.match(fs.readFileSync(summary, 'utf8'), /NO-GO/);
  assert.equal(fs.existsSync(path.join(dir, 'm.md')), false);
});
